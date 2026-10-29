import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCatalogueHandler } from "../server/catalogue.js";
import { updateCatalogueStore } from "../server/catalogue-store.js";

const config = { address: "0x0000000000000000000000000000000000000001", chainId: 31337, rpcUrl: "http://127.0.0.1:8545", runtimeCodeHash: `0x${"1".repeat(64)}` };
const metadata = { id: "1", name: "Tent", category: "Other", description: "Test tent" };

async function fixture(t, options = {}) {
  const prefix = join(tmpdir(), "blockrent-http-security-");
  const directory = await mkdtemp(prefix);
  const dataFile = join(directory, "catalogue.json");
  let verifications = 0;
  const handler = createCatalogueHandler({ dataFile, readDeployment: async () => config, verifyMetadata: async () => { verifications++; }, ...options });
  const server = createServer((req, res) => { void handler(req, res, () => { res.statusCode = 404; res.end(); }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.ok(resolve(directory).startsWith(resolve(prefix)));
    await rm(directory, { recursive: true, force: true });
  });
  const post = (body = metadata, headers = {}) => fetch(`${url}/api/catalogue`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: url, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { url, dataFile, post, verifications: () => verifications };
}

test("API accepts committed-metadata verification and adds defensive response headers", async t => {
  const { url, post, verifications } = await fixture(t);
  assert.equal((await post()).status, 200);
  const response = await fetch(`${url}/api/catalogue?ids=1`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal((await response.json()).assets[0].name, "Tent");
  assert.equal(verifications(), 1);
});

test("foreign, missing and null origins cannot write; hostile Host headers cannot read", async t => {
  const { url, post, verifications } = await fixture(t);
  for (const origin of ["http://evil.example", "null", url.replace("http:", "https:")]) {
    assert.equal((await post(metadata, { Origin: origin })).status, 403);
  }
  assert.equal((await fetch(`${url}/api/catalogue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metadata) })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const req = request(`${url}/api/catalogue`, { headers: { Host: "evil.example" } }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject); req.end();
  });
  assert.equal(status, 403);
  assert.equal(verifications(), 0);
});

test("invalid JSON, object types, MIME and oversized bodies stop before RPC validation", async t => {
  const { post, verifications } = await fixture(t);
  assert.equal((await post("{bad")).status, 400);
  for (const value of [null, [], { ...metadata, name: {} }, { ...metadata, description: [] }, { ...metadata, id: "1".repeat(79) }]) {
    assert.equal((await post(JSON.stringify(value))).status, 400);
  }
  assert.equal((await post(metadata, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post(metadata, { "Content-Encoding": "gzip" })).status, 415);
  assert.equal((await post("x".repeat(8193))).status, 413);
  assert.equal(verifications(), 0);
});

test("slow request bodies time out without hanging the server", async t => {
  const { url } = await fixture(t, { bodyTimeoutMs: 50 });
  const status = await new Promise((resolve, reject) => {
    const req = request(`${url}/api/catalogue`, { method: "POST", headers: { Origin: url, "Content-Type": "application/json" } }, res => {
      res.resume(); res.on("end", () => { req.destroy(); resolve(res.statusCode); });
    });
    req.on("error", reject);
    req.write('{"id":');
  });
  assert.equal(status, 408);
});

test("rate limits cannot be bypassed with X-Forwarded-For", async t => {
  const { post, verifications } = await fixture(t, { postLimit: 2 });
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  const response = await post(metadata, { "X-Forwarded-For": "203.0.113.10" });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(verifications(), 2);
});

test("a stalled validator is timed out and releases the RPC concurrency slot", async t => {
  const { post } = await fixture(t, { rpcTimeoutMs: 50, maxRpcInFlight: 1, verifyMetadata: () => new Promise(() => {}) });
  const first = await post();
  assert.equal(first.status, 503);
  assert.match((await first.json()).error, /timed out/);
  const second = await post();
  assert.match((await second.json()).error, /timed out/);
});

test("RPC concurrency is bounded while a previous verification is still running", async t => {
  let entered;
  let release;
  const started = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const { post } = await fixture(t, { maxRpcInFlight: 1, verifyMetadata: async () => { entered(); await wait; } });
  const first = post();
  try {
    await started;
    const response = await post();
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /busy/);
  } finally { release(); }
  assert.equal((await first).status, 200);
});

test("catalogue results and requested ID lists are bounded to 50", async t => {
  const { url, dataFile } = await fixture(t);
  const scope = `${config.chainId}:${config.address.toLowerCase()}:${config.runtimeCodeHash}`;
  await updateCatalogueStore(dataFile, store => {
    store[scope] = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(i + 1), { ...metadata, id: String(i + 1) }]));
  });
  assert.equal((await (await fetch(`${url}/api/catalogue`)).json()).assets.length, 50);
  const response = await fetch(`${url}/api/catalogue?ids=51,52`);
  assert.deepEqual((await response.json()).assets.map(asset => asset.id), ["51", "52"]);
  assert.equal((await fetch(`${url}/api/catalogue?ids=${Array(51).fill("1").join(",")}`)).status, 400);
  assert.equal((await fetch(`${url}/api/catalogue?ids=__proto__`)).status, 400);
});

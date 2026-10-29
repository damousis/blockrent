import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { readCatalogueStore, updateCatalogueStore } from "../server/catalogue-store.js";

async function fixture(t) {
  const prefix = join(tmpdir(), "blockrent-security-");
  const directory = await mkdtemp(prefix);
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(prefix)));
    await rm(directory, { recursive: true, force: true });
  });
  return join(directory, "catalogue.json");
}

test("two independent processes cannot overwrite each other's catalogue updates", async t => {
  const file = await fixture(t);
  const moduleUrl = new URL("../server/catalogue-store.js", import.meta.url).href;
  const worker = key => new Promise((resolve, reject) => {
    const code = `import {updateCatalogueStore} from ${JSON.stringify(moduleUrl)}; await updateCatalogueStore(process.argv[1], async store => { await new Promise(r => setTimeout(r, 30)); store[process.argv[2]] = { saved: true }; });`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, file, key], { windowsHide: true });
    let errors = "";
    child.stderr.on("data", chunk => { errors += chunk; });
    child.on("error", reject);
    child.on("close", status => status === 0 ? resolve() : reject(new Error(errors)));
  });
  await Promise.all([worker("setup"), worker("api")]);
  assert.deepEqual(await readCatalogueStore(file), { setup: { saved: true }, api: { saved: true } });
});

test("failed and oversized writes preserve the last valid catalogue", async t => {
  const file = await fixture(t);
  await updateCatalogueStore(file, store => { store.original = { saved: true }; });
  const original = await readFile(file, "utf8");
  await assert.rejects(() => updateCatalogueStore(file, store => { store.changed = {}; throw new Error("Simulated failure"); }));
  assert.equal(await readFile(file, "utf8"), original);
  await assert.rejects(() => updateCatalogueStore(file, store => { store.large = { data: "x".repeat(1000) }; }, { maxBytes: 100 }), /storage limit/);
  assert.equal(await readFile(file, "utf8"), original);
  await updateCatalogueStore(file, store => { store.retry = { saved: true }; });
  assert.equal((await readCatalogueStore(file)).retry.saved, true);
});

test("corrupt storage fails closed and a retained lock has a bounded wait", async t => {
  const file = await fixture(t);
  await writeFile(file, "{broken");
  await assert.rejects(() => updateCatalogueStore(file, store => { store.replacement = {}; }));
  assert.equal(await readFile(file, "utf8"), "{broken");
  await writeFile(`${file}.lock`, "existing lock");
  await assert.rejects(() => updateCatalogueStore(file, () => {}, { lockTimeoutMs: 30 }), /busy/);
  assert.equal(await readFile(`${file}.lock`, "utf8"), "existing lock");
});

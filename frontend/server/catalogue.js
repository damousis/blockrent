import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Contract, FetchRequest, JsonRpcProvider, MaxUint256, ZeroAddress, getAddress, keccak256 } from "ethers";
import { metadataHash, normalizeMetadata } from "../src/catalogue.js";
import { readCatalogueStore, updateCatalogueStore } from "./catalogue-store.js";
import { HttpError, checkLocalRequest, createRequestLimiter, readJsonBody, withDeadline } from "./http-security.js";

// Local shared catalogue. Only details committed by an on-chain registration
// can be published; no private keys or wallet credentials are handled here.
export function createCatalogueHandler(options = {}) {
  const dataFile = options.dataFile ?? fileURLToPath(new URL("../data/catalogue.json", import.meta.url));
  const readDeployment = options.readDeployment ?? (async () => JSON.parse(await readFile(new URL("../src/deployment.json", import.meta.url), "utf8")));
  const limitRequests = createRequestLimiter(options);
  const rpcTimeoutMs = options.rpcTimeoutMs ?? 5000;
  let validating = 0;
  let activeRequests = 0;
  const send = (res, status, body) => {
    if (res.destroyed || res.writableEnded) return;
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (status >= 400) res.setHeader("Connection", "close");
    if (status === 429) res.setHeader("Retry-After", "60");
    if (status === 503) res.setHeader("Retry-After", "5");
    res.end(JSON.stringify(body));
  };
  return async (req, res, next = () => {}) => {
    if (req.url?.split("?")[0] !== "/api/catalogue") return next();
    let admitted = false;
    try {
      checkLocalRequest(req, req.method === "POST");
      if (req.method !== "GET" && req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        return send(res, 405, { error: "Method not allowed." });
      }
      limitRequests(req);
      if (activeRequests >= (options.maxRequestsInFlight ?? 8)) throw new HttpError(503, "Catalogue is busy. Please retry.");
      activeRequests++;
      admitted = true;
      const config = await readDeployment();
      checkDeployment(config);
      const scope = `${config.chainId}:${config.address.toLowerCase()}:${config.runtimeCodeHash}`;
      if (req.method === "GET") {
        const ids = requestedIds(new URL(req.url, `http://${req.headers.host}`));
        const store = await readCatalogueStore(dataFile);
        const entries = store[scope] ?? {};
        const keys = ids ?? Object.keys(entries).slice(0, 50);
        return send(res, 200, { address: config.address, chainId: config.chainId, assets: keys.filter(id => Object.hasOwn(entries, id)).map(id => entries[id]) });
      }
      const input = await readJsonBody(req, { timeoutMs: options.bodyTimeoutMs ?? 3000 });
      let metadata;
      try { metadata = normalizeMetadata(input); }
      catch (error) { throw new HttpError(400, error.message); }
      if (validating >= (options.maxRpcInFlight ?? 4)) throw new HttpError(503, "Blockchain validation is busy. Please retry.");
      validating++;
      try {
        if (options.verifyMetadata) await withDeadline(() => options.verifyMetadata(config, metadata), rpcTimeoutMs);
        else await verifyCommitment(config, metadata, rpcTimeoutMs);
      } finally { validating--; }

      // Serialize writes and replace the file atomically to avoid losing another
      // user's listing when two registrations finish at the same time.
      await updateCatalogueStore(dataFile, store => {
        store[scope] ??= {};
        if (JSON.stringify(store[scope][metadata.id]) === JSON.stringify(metadata)) return false;
        store[scope][metadata.id] = metadata;
      });
      send(res, 200, { asset: metadata });
    } catch (error) {
      req.resume();
      const status = error instanceof HttpError ? error.status : 503;
      if (status === 503) console.error(JSON.stringify({ event: "catalogue_unavailable", error: error.name }));
      send(res, status, { error: error instanceof HttpError ? error.message : "The local catalogue is unavailable. Check the node and retry." });
    } finally {
      if (admitted) activeRequests--;
    }
  };
}

function checkDeployment(config) {
  getAddress(config.address);
  const rpc = new URL(config.rpcUrl);
  if (config.chainId !== 31337 || !/^0x[0-9a-fA-F]{64}$/.test(config.runtimeCodeHash) || rpc.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(rpc.hostname) || rpc.username || rpc.password || rpc.search || rpc.hash) {
    throw new HttpError(503, "Run local demo setup again.");
  }
}

function requestedIds(url) {
  const raw = url.searchParams.get("ids");
  if (raw === null) return null;
  if (raw === "") return [];
  const ids = raw.split(",");
  if (raw.length > 4000 || ids.length > 50 || ids.some(id => !/^[1-9]\d{0,77}$/.test(id) || BigInt(id) > MaxUint256)) {
    throw new HttpError(400, "Request at most 50 valid asset IDs.");
  }
  return [...new Set(ids)];
}

async function verifyCommitment(config, metadata, timeoutMs) {
  const transport = new FetchRequest(config.rpcUrl);
  transport.timeout = timeoutMs;
  const provider = new JsonRpcProvider(transport, undefined, { cacheTimeout: -1 });
  try {
    await withDeadline(async () => {
      if ((await provider.getNetwork()).chainId !== BigInt(config.chainId)) throw new HttpError(503, "Local chain changed. Run setup again.");
      const code = await provider.getCode(config.address);
      if (code === "0x" || keccak256(code) !== config.runtimeCodeHash) throw new HttpError(503, "Contract changed. Run setup again.");
      const contract = new Contract(config.address, [
        "function assets(uint256) view returns (address owner, address renter, uint256 rentedUntil, uint256 pricePerDay)",
        "function metadataHashes(uint256) view returns (bytes32)",
      ], provider);
      const blockTag = await provider.getBlockNumber();
      const [record, commitment] = await Promise.all([
        contract.assets(metadata.id, { blockTag }), contract.metadataHashes(metadata.id, { blockTag }),
      ]);
      if (record.owner === ZeroAddress || commitment !== metadataHash(metadata)) {
        throw new HttpError(409, "These details do not match a registered asset. Confirm registration first.");
      }
    }, timeoutMs);
  } finally { provider.destroy(); }
}

export function createCataloguePlugin(options = {}) {
  const handler = createCatalogueHandler(options);
  const install = server => {
    server.middlewares.use(handler);
    if (server.httpServer) {
      server.httpServer.requestTimeout = 10_000;
      server.httpServer.headersTimeout = 10_000;
      server.httpServer.keepAliveTimeout = 5000;
      server.httpServer.maxConnections = 100;
    }
  };
  return { name: "blockrent-catalogue", configureServer: install, configurePreviewServer: install };
}

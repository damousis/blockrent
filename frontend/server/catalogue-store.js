import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const MAX_STORE_BYTES = 8 * 1024 * 1024;

export async function readCatalogueStore(file, maxBytes = MAX_STORE_BYTES) {
  let handle;
  try {
    handle = await open(file, "r");
    const chunks = [];
    let size = 0;
    while (size <= maxBytes) {
      const buffer = Buffer.alloc(Math.min(65536, maxBytes + 1 - size));
      const { bytesRead } = await handle.read(buffer);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      size += bytesRead;
    }
    if (size > maxBytes) throw new Error("Catalogue storage limit reached");
    const store = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!store || typeof store !== "object" || Array.isArray(store)) throw new Error("Invalid catalogue store");
    return store;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error; // Corrupt data must not be silently replaced with an empty store.
  } finally { await handle?.close(); }
}

// Used by BOTH setup and the API. A process-local queue alone loses updates
// when another process reads and rewrites the same JSON file.
export async function updateCatalogueStore(file, mutate, options = {}) {
  file = resolve(file);
  const lockFile = `${file}.lock`;
  const tempFile = `${file}.${randomUUID()}.tmp`;
  const maxBytes = options.maxBytes ?? MAX_STORE_BYTES;
  const deadline = Date.now() + (options.lockTimeoutMs ?? 2000);
  await mkdir(dirname(file), { recursive: true });
  let lock;
  try {
    while (!lock) {
      try { lock = await open(lockFile, "wx", 0o600); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() >= deadline) throw new Error("Catalogue busy; retry later");
        await delay(20);
      }
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    const store = await readCatalogueStore(file, maxBytes);
    const changed = await mutate(store);
    if (changed === false) return; // Identical retries do not churn the disk.
    const data = JSON.stringify(store, null, 2) + "\n";
    if (Buffer.byteLength(data) > maxBytes) throw new Error("Catalogue storage limit reached");
    const temp = await open(tempFile, "wx", 0o600);
    try { await temp.writeFile(data); await temp.sync(); }
    finally { await temp.close(); }
    await rename(tempFile, file);
  } finally {
    if (lock) {
      try {
        try { await unlink(tempFile); } catch (error) { if (error.code !== "ENOENT") throw error; }
      } finally {
        await lock.close();
        await unlink(lockFile);
      }
    }
  }
}

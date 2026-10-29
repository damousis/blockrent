export class HttpError extends Error {
  constructor(status, message) { super(message); this.name = "HttpError"; this.status = status; }
}

export function checkLocalRequest(req, writing) {
  const host = req.headers.host ?? "";
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):([0-9]+)$/.exec(host);
  if (!match || Number(match[2]) !== req.socket.localPort) throw new HttpError(403, "Use the local BlockRent address.");
  if (writing) {
    const expected = `http://${host}`;
    if (req.headers.origin !== expected || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) {
      throw new HttpError(403, "Asset writes must come from this BlockRent website.");
    }
  }
}

export function createRequestLimiter(options = {}) {
  const buckets = new Map();
  const windowMs = options.windowMs ?? 60_000;
  return req => {
    const now = Date.now();
    for (const [key, value] of buckets) if (now >= value.until) buckets.delete(key);
    // Never trust X-Forwarded-For in this direct, loopback-only deployment.
    const key = `${req.socket.remoteAddress}:${req.method}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 128) throw new HttpError(429, "Too many requests. Please wait and retry.");
      bucket = { count: 0, until: now + windowMs };
      buckets.set(key, bucket);
    }
    const limit = req.method === "POST" ? (options.postLimit ?? 30) : (options.readLimit ?? 120);
    if (++bucket.count > limit) throw new HttpError(429, "Too many requests. Please wait and retry.");
  };
}

export function readJsonBody(req, { maxBytes = 8192, timeoutMs = 3000 } = {}) {
  const contentType = req.headers["content-type"]?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new HttpError(415, "Send JSON metadata.");
  if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") throw new HttpError(415, "Compressed request bodies are not supported.");
  if (Number(req.headers["content-length"] ?? 0) > maxBytes) throw new HttpError(413, "Asset details are too large.");
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", onData); req.off("end", onEnd);
      req.off("aborted", onAbort); req.off("error", onAbort);
    };
    const fail = error => { cleanup(); req.once("error", () => {}); req.resume(); reject(error); };
    const onData = chunk => {
      size += chunk.length;
      if (size > maxBytes) return fail(new HttpError(413, "Asset details are too large."));
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new HttpError(400, "Invalid JSON metadata.")); }
    };
    const onAbort = () => fail(new HttpError(400, "Request body was interrupted."));
    const timer = setTimeout(() => fail(new HttpError(408, "Request body timed out.")), timeoutMs);
    req.on("data", onData); req.on("end", onEnd);
    req.on("aborted", onAbort); req.on("error", onAbort);
  });
}

export async function withDeadline(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new HttpError(503, "Blockchain validation timed out. Please retry.")), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

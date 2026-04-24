// Atelier sandbox server.
//
// Two modes:
//   - MODE=local  (default): serve variants from local disk at
//     /variant/<id>/*. Used in dev where the FastAPI backend writes to the
//     shared `assets/variants/<id>/` dir.
//   - MODE=proxy: fetch variant files from a Supabase Storage public bucket
//     (or any HTTPS origin) and stream them back with the correct
//     Content-Type derived from the extension. This dodges Supabase's
//     forced `text/plain + nosniff` on HTML uploads, which otherwise breaks
//     iframe rendering.
//
// Both modes expose the same URL shape so iframes don't care which one runs.
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, extname, normalize } from "node:path";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

const PORT = Number(process.env.ATELIER_SANDBOX_PORT || process.env.PORT || 4100);
const MODE = (process.env.ATELIER_SANDBOX_MODE || "local").toLowerCase();
const ASSETS_DIR = resolve(process.env.ATELIER_ASSETS_DIR || "../assets");
const VARIANTS_DIR = join(ASSETS_DIR, "variants");
const WEB_ORIGIN = process.env.ATELIER_WEB_ORIGIN || "*";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "variants";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function mimeFor(filePath) {
  const ext = extname(filePath).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": WEB_ORIGIN,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function isSafePath(requested, root) {
  const resolved = normalize(requested);
  return resolved.startsWith(root);
}

async function serveLocal(variantId, rest, res) {
  const variantRoot = join(VARIANTS_DIR, variantId);
  const filePath = join(variantRoot, rest);
  if (!isSafePath(filePath, variantRoot)) {
    send(res, 403, "Forbidden");
    return;
  }
  let s;
  try {
    s = await stat(filePath);
  } catch {
    send(res, 404, `Missing: ${rest}`);
    return;
  }
  if (s.isDirectory()) {
    send(res, 404, "Is a directory");
    return;
  }
  res.writeHead(200, {
    "Content-Type": mimeFor(filePath),
    "Content-Length": s.size,
    "Access-Control-Allow-Origin": WEB_ORIGIN,
    "Cache-Control": "no-store",
    "X-Frame-Options": "ALLOWALL",
    "Content-Security-Policy": "frame-ancestors *",
  });
  createReadStream(filePath).pipe(res);
}

function proxyFetch(url, timeoutMs = 30000) {
  return new Promise((resolveProm, rejectProm) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "http:" ? httpRequest : httpsRequest;
    const req = lib(url, { method: "GET" }, (resp) => {
      const chunks = [];
      resp.on("data", (c) => chunks.push(c));
      resp.on("end", () => {
        resolveProm({
          statusCode: resp.statusCode,
          headers: resp.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", rejectProm);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout fetching ${url}`));
    });
    req.end();
  });
}

async function serveProxy(variantId, rest, res) {
  if (!SUPABASE_URL) {
    send(res, 500, "SUPABASE_URL not configured in proxy mode");
    return;
  }
  const cleanRest = rest.replace(/^\/+/, "");
  const sourceUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${variantId}/${cleanRest}`;
  let upstream;
  try {
    upstream = await proxyFetch(sourceUrl);
  } catch (err) {
    console.error("proxy fetch error:", err.message, "url:", sourceUrl);
    send(res, 502, `Upstream fetch failed: ${err.message}`);
    return;
  }
  if (upstream.statusCode !== 200) {
    send(res, upstream.statusCode, `Upstream ${upstream.statusCode}`);
    return;
  }
  // Override Content-Type based on extension — Supabase serves .html as
  // text/plain for safety, which breaks iframe rendering. The whole reason
  // this proxy exists.
  res.writeHead(200, {
    "Content-Type": mimeFor(cleanRest),
    "Content-Length": upstream.body.length,
    "Access-Control-Allow-Origin": WEB_ORIGIN,
    "Cache-Control": "public, max-age=60",
    "X-Frame-Options": "ALLOWALL",
    "Content-Security-Policy": "frame-ancestors *",
  });
  res.end(upstream.body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/healthz") {
      send(res, 200, JSON.stringify({ ok: true, service: "atelier-sandbox", mode: MODE }), {
        "Content-Type": "application/json",
      });
      return;
    }

    const match = url.pathname.match(/^\/variant\/([^/]+)(\/.*)?$/);
    if (!match) {
      send(res, 404, "Not found");
      return;
    }
    const [, variantId, restRaw] = match;
    let rest = restRaw || "/";
    if (rest === "/") rest = "/index.html";
    else if (rest.endsWith("/")) rest += "index.html";

    if (MODE === "proxy") {
      await serveProxy(variantId, rest, res);
    } else {
      await serveLocal(variantId, rest, res);
    }
  } catch (err) {
    console.error("sandbox error:", err);
    if (!res.headersSent) send(res, 500, "Internal error");
  }
});

server.listen(PORT, () => {
  console.log(
    `[atelier-sandbox] mode=${MODE} listening on :${PORT}` +
      (MODE === "proxy" ? ` — proxying to ${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/` : ` — serving ${VARIANTS_DIR}`)
  );
});

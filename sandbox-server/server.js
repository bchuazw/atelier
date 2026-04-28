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
//
// Every HTML response is augmented with a tiny height-reporter script that
// posts the document's actual scrollHeight to the parent window. The web app's
// Compare viewer listens for these messages and resizes each iframe to fit
// its content exactly — eliminating the "page ends, then ~600px of empty
// space" effect that happens when a variant is shorter than the iframe's
// fallback height. Top-level browsing of /p/<slug>/ doesn't have a parent
// frame, so the postMessage call is a harmless no-op there.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, extname, normalize } from "node:path";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

const PORT = Number(process.env.ATELIER_SANDBOX_PORT || process.env.PORT || 4100);
const MODE = (process.env.ATELIER_SANDBOX_MODE || "local").toLowerCase();
const ASSETS_DIR = resolve(process.env.ATELIER_ASSETS_DIR || "../assets");
const VARIANTS_DIR = join(ASSETS_DIR, "variants");
// Where the FastAPI publish endpoint copies variant trees keyed by slug.
// Served at /p/<slug>/ — see `routes/nodes.py::publish_node`.
const PUBLISHED_DIR = join(ASSETS_DIR, "published");
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

// Tiny script appended to every HTML response. Reports the page's actual
// scrollHeight to the parent frame on load + on every body resize so the
// Compare viewer can size its iframes to the real content height (no
// trailing empty space when a variant is shorter than the iframe's
// fallback). We deliberately avoid heavier libraries (iframe-resizer etc.)
// — the parent listens for `{type: 'atelier:height', height}` and the
// payload is keyed by the iframe's src URL, so multiple variants on the
// same page resize independently.
const HEIGHT_REPORTER = `<script>(function(){
  function h(){
    try {
      var v = Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0
      );
      if (v > 0 && parent !== window) parent.postMessage({type:'atelier:height',height:v}, '*');
    } catch(e) {}
  }
  if (document.readyState === 'complete') h();
  else window.addEventListener('load', h);
  window.addEventListener('resize', h);
  // Re-report after late-loading fonts/images settle. Two staggered ticks
  // catch most cases without spamming the parent.
  setTimeout(h, 200);
  setTimeout(h, 1000);
  if (window.ResizeObserver && document.body) {
    try { new ResizeObserver(h).observe(document.body); } catch(e) {}
  }
})();</script>`;

// Inject the height reporter into an HTML buffer right before </body>.
// Falls back to appending at the end if there's no closing tag (Sonnet
// occasionally produces fragment-ish HTML on small templates). Returns a
// new Buffer so the caller can recompute Content-Length.
function injectHeightReporter(buf) {
  const html = buf.toString("utf-8");
  const lower = html.toLowerCase();
  const idx = lower.lastIndexOf("</body>");
  const out = idx >= 0
    ? html.slice(0, idx) + HEIGHT_REPORTER + html.slice(idx)
    : html + HEIGHT_REPORTER;
  return Buffer.from(out, "utf-8");
}

function isHtml(filePath) {
  const ext = extname(filePath).toLowerCase();
  return ext === ".html" || ext === ".htm";
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
  // HTML responses get the height-reporter injected. We have to read the
  // file into memory + recompute Content-Length, which is fine for HTML
  // (typically <100KB) but binary assets keep streaming for performance.
  if (isHtml(filePath)) {
    const buf = injectHeightReporter(await readFile(filePath));
    res.writeHead(200, {
      "Content-Type": mimeFor(filePath),
      "Content-Length": buf.length,
      "Access-Control-Allow-Origin": WEB_ORIGIN,
      "Cache-Control": "no-store",
      "X-Frame-Options": "ALLOWALL",
      "Content-Security-Policy": "frame-ancestors *",
    });
    res.end(buf);
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

// Serve a published variant tree from disk. Mirrors `serveLocal` but
// rooted at `published/<slug>/` and with looser caching since publish is a
// deliberate action — re-publish overwrites the directory in place, and a
// short cache makes the URL feel like a real CDN-backed page when pasted
// into other tools.
async function servePublished(slug, rest, res) {
  const publishedRoot = join(PUBLISHED_DIR, slug);
  const filePath = join(publishedRoot, rest);
  if (!isSafePath(filePath, publishedRoot)) {
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
  if (isHtml(filePath)) {
    const buf = injectHeightReporter(await readFile(filePath));
    res.writeHead(200, {
      "Content-Type": mimeFor(filePath),
      "Content-Length": buf.length,
      "Access-Control-Allow-Origin": WEB_ORIGIN,
      "Cache-Control": "public, max-age=30",
      "X-Frame-Options": "ALLOWALL",
      "Content-Security-Policy": "frame-ancestors *",
    });
    res.end(buf);
    return;
  }
  res.writeHead(200, {
    "Content-Type": mimeFor(filePath),
    "Content-Length": s.size,
    "Access-Control-Allow-Origin": WEB_ORIGIN,
    "Cache-Control": "public, max-age=30",
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
  const body = isHtml(cleanRest) ? injectHeightReporter(upstream.body) : upstream.body;
  res.writeHead(200, {
    "Content-Type": mimeFor(cleanRest),
    "Content-Length": body.length,
    "Access-Control-Allow-Origin": WEB_ORIGIN,
    "Cache-Control": "public, max-age=60",
    "X-Frame-Options": "ALLOWALL",
    "Content-Security-Policy": "frame-ancestors *",
  });
  res.end(body);
}

// Proxy-mode counterpart of `servePublished`. Resolves a slug to
// `<SUPABASE_URL>/storage/v1/object/public/<bucket>/published/<slug>/<rest>`
// — the same prefix shape that `storage/supabase.py::upload_published_tree`
// writes to. Cache-Control matches the local-disk path (30s) so behavior is
// indistinguishable from a developer's POV.
async function serveProxyPublished(slug, rest, res) {
  const cleanRest = rest.replace(/^\/+/, "");
  const sourceUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/published/${slug}/${cleanRest}`;
  let upstream;
  try {
    upstream = await proxyFetch(sourceUrl);
  } catch (err) {
    console.error("proxy fetch error (published):", err.message, "url:", sourceUrl);
    send(res, 502, `Upstream fetch failed: ${err.message}`);
    return;
  }
  if (upstream.statusCode === 404) {
    // Pass through 404 rather than masking it as 501 — the slug genuinely
    // doesn't exist in the bucket.
    send(res, 404, `Missing: ${cleanRest}`);
    return;
  }
  if (upstream.statusCode !== 200) {
    send(res, upstream.statusCode, `Upstream ${upstream.statusCode}`);
    return;
  }
  const body = isHtml(cleanRest) ? injectHeightReporter(upstream.body) : upstream.body;
  res.writeHead(200, {
    "Content-Type": mimeFor(cleanRest),
    "Content-Length": body.length,
    "Access-Control-Allow-Origin": WEB_ORIGIN,
    "Cache-Control": "public, max-age=30",
    "X-Frame-Options": "ALLOWALL",
    "Content-Security-Policy": "frame-ancestors *",
  });
  res.end(body);
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

    // Published-URL route — `/p/<slug>/...`.
    //   local mode: serves files from `<assets>/published/<slug>/` on disk.
    //   proxy mode: streams from Supabase Storage at
    //     `<SUPABASE_URL>/storage/v1/object/public/<bucket>/published/<slug>/...`
    //     (matches the prefix written by `storage/supabase.py::upload_published_tree`).
    //   proxy mode without SUPABASE_URL: 501 — this deployment is wired
    //     for hosted serving but operator hasn't supplied a Supabase project,
    //     so hosted publish is genuinely unavailable.
    const publishedMatch = url.pathname.match(/^\/p\/([^/]+)(\/.*)?$/);
    if (publishedMatch) {
      const [, slug, restRaw] = publishedMatch;
      let rest = restRaw || "/";
      if (rest === "/") rest = "/index.html";
      else if (rest.endsWith("/")) rest += "index.html";
      if (MODE === "proxy") {
        if (!SUPABASE_URL) {
          send(res, 501, "Published URLs are not available — SUPABASE_URL not configured");
          return;
        }
        await serveProxyPublished(slug, rest, res);
        return;
      }
      await servePublished(slug, rest, res);
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

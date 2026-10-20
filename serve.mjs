import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

/**
 * Tiny static file server for the prototype folder (design review only).
 * Not part of the production stack — the Worker serves the built assets.
 */
const root = resolve(process.cwd());
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (path.endsWith("/")) path += "index.html";
    // Keep the request inside the served root (no path traversal).
    const target = resolve(join(root, normalize(path)));
    if (target !== root && !target.startsWith(root + sep)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    const data = await readFile(target);
    res.writeHead(200, {
      "Content-Type": mime[extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(8098, "127.0.0.1", () => console.log("http://127.0.0.1:8098/"));

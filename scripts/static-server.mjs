import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), "out");
const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const port = Number.parseInt(portArgument?.split("=")[1] ?? "3100", 10);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const pathForRequest = (pathname) => {
  const decodedPath = decodeURIComponent(pathname);
  const normalizedPath = normalize(decodedPath).replace(/^\.\.(\/|\\)/, "");
  const directPath = join(root, normalizedPath === "/" ? "index.html" : normalizedPath);
  const extension = extname(directPath);
  if (extension) return directPath;
  return `${directPath}.html`;
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    let filePath = pathForRequest(requestUrl.pathname);
    try {
      await stat(filePath);
    } catch {
      filePath = requestUrl.pathname === "/404" ? join(root, "404.html") : join(root, "404.html");
    }

    const contents = await readFile(filePath);
    const type = contentTypes[extname(filePath)] ?? "application/octet-stream";
    response.writeHead(200, {
      "cache-control": filePath.endsWith("/sw.js") || filePath.endsWith("/manifest.webmanifest")
        ? "no-cache"
        : "public, max-age=0",
      "content-type": type,
    });
    response.end(contents);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Static export available at http://127.0.0.1:${port}`);
});

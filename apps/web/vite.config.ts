import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { handleDecide } from "@arena/decisions";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const proxySource = fileURLToPath(new URL("../../packages/decisions/src", import.meta.url));

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const init: RequestInit = { method: req.method ?? "GET", headers: { "content-type": req.headers["content-type"] ?? "application/json" } };
  if (init.method !== "GET" && init.method !== "HEAD") init.body = Buffer.concat(chunks);
  return new Request(`http://localhost${req.url ?? "/"}`, init);
}

/**
 * Dev-only stand-in for the Worker: serves /api/decide/:lane with keys from
 * the repo's .env, re-read per request so a pasted key works without a
 * restart. Nothing from .env reaches the browser bundle (no VITE_ prefix).
 */
function decideProxy(): Plugin {
  return {
    name: "arena-decide-proxy",
    configureServer(server) {
      // The proxy is loaded once with this config; restart when its source
      // changes, or it keeps serving stale questions.
      server.watcher.add(proxySource);
      server.watcher.on("change", (file) => {
        if (file.startsWith(proxySource)) void server.restart();
      });
      server.middlewares.use("/api/decide/", (req, res) => {
        const laneId = (req.url ?? "").replace(/^\//, "").split(/[/?]/)[0] ?? "";
        const env = loadEnv(server.config.mode, repoRoot, "");
        void (async () => {
          try {
            const response = await handleDecide(await toRequest(req), laneId, env);
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(Buffer.from(await response.arrayBuffer()));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ detail: err instanceof Error ? err.message : String(err) }));
          }
        })();
      });
    },
  };
}

export default defineConfig({ plugins: [decideProxy()] });

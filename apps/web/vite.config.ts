import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import { defineConfig, loadEnv, type Plugin } from "vite";
import type { handleDecide as HandleDecide } from "@arena/decisions";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const replaysDir = fileURLToPath(new URL("public/replays/", import.meta.url));
const proxyEntry = fileURLToPath(new URL("../../packages/decisions/src/proxy.ts", import.meta.url));

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
 * The proxy loads through Vite's module graph, so edits to it apply on the
 * next request (a plain import stays cached in Node across restarts).
 */
function decideProxy(): Plugin {
  return {
    name: "arena-decide-proxy",
    configureServer(server) {
      server.middlewares.use("/api/decide/", (req, res) => {
        const laneId = (req.url ?? "").replace(/^\//, "").split(/[/?]/)[0] ?? "";
        const env = loadEnv(server.config.mode, repoRoot, "");
        void (async () => {
          try {
            const { handleDecide } = (await server.ssrLoadModule(proxyEntry)) as { handleDecide: typeof HandleDecide };
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

/**
 * Dev-only: POST /api/replays/:name writes a finished run to public/replays,
 * where the replay player (and the public build) picks it up. The name is
 * checked so a request cannot write outside that folder.
 */
function saveReplays(): Plugin {
  return {
    name: "arena-save-replays",
    configureServer(server) {
      server.middlewares.use("/api/replays/", (req, res) => {
        const name = (req.url ?? "").replace(/^\//, "").split("?")[0] ?? "";
        const reply = (status: number, detail: string): void => {
          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ detail }));
        };
        if (req.method !== "POST" || !/^[\w-]+$/.test(name)) return reply(400, "POST /api/replays/<name>, name made of letters, digits, - and _");
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          try {
            const body = Buffer.concat(chunks).toString("utf8");
            JSON.parse(body);
            await mkdir(replaysDir, { recursive: true });
            await writeFile(`${replaysDir}${name}.json`, body);
            reply(201, `saved ${name}.json`);
          } catch (err) {
            reply(500, err instanceof Error ? err.message : String(err));
          }
        })();
      });
    },
  };
}

export default defineConfig({ plugins: [decideProxy(), saveReplays()] });

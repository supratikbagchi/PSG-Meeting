// Single Vercel Serverless Function for the whole multi-tenant API (Hobby plan allows 12 functions).
// vercel.json rewrites /api/v1/<path> to /api/v1?path=<path>.
import { handleApi } from "../lib/server/api.js";
import { productionDeps } from "../lib/server/deps.js";

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  const raw = req.query?.path;
  const path = Array.isArray(raw) ? raw.join("/") : String(raw || "");
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  let deps;
  try {
    deps = productionDeps();
  } catch (e: any) {
    console.error("[api/v1] configuration error", e);
    return res.status(503).json({ error: "The service is not configured yet. Please try again later.", code: "not_configured" });
  }
  const { path: _p, ...query } = req.query || {};
  const out = await handleApi({ method: req.method || "GET", path, query, body, headers: req.headers }, deps);
  res.status(out.status).json(out.body);
}

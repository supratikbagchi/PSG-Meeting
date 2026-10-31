// Local development / self-hosted server: serves the multi-tenant API (/api/v1, same code as the
// Vercel function in api/v1.ts) and the React app. Configuration comes from .env (see .env.example).
import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { handleApi } from "./lib/server/api.js";
import { productionDeps } from "./lib/server/deps.js";

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.all("/api/v1/*", async (req, res) => {
    const out = await handleApi(
      { method: req.method, path: req.params[0] || "", query: req.query as any, body: req.body, headers: req.headers as any },
      productionDeps()
    );
    res.status(out.status).json(out.body);
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Server running at http://localhost:${PORT}`));
}

startServer().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { requireAuth } from "./auth.js";
import authRoutes from "./routes/auth.routes.js";
import leadsRoutes from "./routes/leads.routes.js";
import stagesRoutes from "./routes/stages.routes.js";
import verifyRoutes from "./routes/verify.routes.js";

const PUBLIC_API_PATHS = new Set(["/api/login", "/api/logout"]);

/**
 * createApp — arma la app Hono, exportada (no arrancada) para poder testearla
 * con app.request() sin levantar un puerto real (patron usado en los tests
 * deterministicos del repo, ver tests/deterministic/deploy.test.ts).
 *
 * Rutas de leads/verify/stages se agregan en los batches siguientes; se
 * montan bajo /api y quedan protegidas automaticamente por el guard de abajo
 * (todo /api/* menos login/logout exige sesion).
 */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Guard: toda /api/* requiere sesion, salvo el propio login/logout.
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path)) return next();
    return requireAuth(c, next);
  });

  app.route("/api", authRoutes);
  app.route("/api", leadsRoutes);
  app.route("/api", verifyRoutes);
  app.route("/api", stagesRoutes);

  // Shell estatico (SPA de un solo archivo, sin build step).
  app.get("/", serveStatic({ path: "./src/panel/static/index.html" }));
  app.use("/*", serveStatic({ root: "./src/panel/static" }));

  return app;
}

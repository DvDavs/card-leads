import { Hono } from "hono";
import { checkPassphrase, clearSessionCookie, setSessionCookie } from "../auth.js";

/** /api/login y /api/logout — sin requireAuth (son el punto de entrada). */
const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const passphrase = typeof body?.passphrase === "string" ? body.passphrase : "";
  if (!passphrase || !checkPassphrase(passphrase)) {
    return c.json({ error: "passphrase incorrecta" }, 401);
  }
  setSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// "whoami" liviano: protegido por el guard de app.ts (no esta en
// PUBLIC_API_PATHS), asi el frontend puede chequear la sesion al cargar sin
// necesitar todavia un endpoint de datos real (ese llega con /api/leads).
authRoutes.get("/me", (c) => c.json({ ok: true }));

export default authRoutes;

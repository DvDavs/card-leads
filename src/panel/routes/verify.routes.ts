import { Hono } from "hono";
import { leadExists, readLead } from "../../lib/storage.js";
import { CorrectionError, correctField, finalizeLeadVerification } from "../services/corrections.js";
import type { CorrectionValue } from "../services/corrections.js";
import { buildVerifyView } from "../services/verify-view.js";

const verifyRoutes = new Hono();

function normalizeValue(v: unknown): CorrectionValue {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(String);
  return String(v);
}

/** Contrato UI-ready de la pantalla de verificacion (colores hex+rgb+swatch, orden de riesgo). */
verifyRoutes.get("/leads/:slug/verify-view", async (c) => {
  const slug = c.req.param("slug");
  if (!(await leadExists(slug))) return c.json({ error: "lead no existe" }, 404);
  return c.json(buildVerifyView(await readLead(slug)));
});

/** Autosave de un campo mientras el operador revisa la tarjeta. */
verifyRoutes.patch("/leads/:slug/field", async (c) => {
  const slug = c.req.param("slug");
  if (!(await leadExists(slug))) return c.json({ error: "lead no existe" }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.field !== "string") {
    return c.json({ error: "body invalido: se espera { field, value }" }, 400);
  }
  try {
    const lead = await correctField(slug, body.field, normalizeValue(body.value));
    return c.json(lead);
  } catch (err) {
    if (err instanceof CorrectionError) return c.json({ error: err.message }, 422);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/** Cierra el checkpoint humano: extracted -> verified. */
verifyRoutes.post("/leads/:slug/finalize", async (c) => {
  const slug = c.req.param("slug");
  if (!(await leadExists(slug))) return c.json({ error: "lead no existe" }, 404);
  try {
    const lead = await finalizeLeadVerification(slug);
    return c.json(lead);
  } catch (err) {
    if (err instanceof CorrectionError) return c.json({ error: err.message }, 422);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export default verifyRoutes;

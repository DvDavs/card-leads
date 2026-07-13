import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { leadExists, readLead } from "../../lib/storage.js";
import { buildOutreachMessage } from "../../lib/outreach.js";
import { runStage, type RunnableStage } from "../services/pipeline.js";

const stagesRoutes = new Hono();

const VALID_STAGES = new Set<RunnableStage>([
  "build-cards",
  "enrich",
  "build-web",
  "deploy",
  "package",
]);

/**
 * Corre UNA stage (build-cards | enrich | build-web | deploy | package) y transmite su
 * progreso por SSE. Deliberadamente coarse (un solo operador): envuelve el
 * await de la stage, no scrapea su console.log (no es estructurado).
 * started -> running (heartbeat cada 2s, prueba liveness en calls de 20-40s
 * como Gemini o scp) -> done | error.
 */
stagesRoutes.post("/leads/:slug/stages/:stage", async (c) => {
  const slug = c.req.param("slug");
  const stage = c.req.param("stage");
  if (!(await leadExists(slug))) return c.json({ error: "lead no existe" }, 404);
  if (!VALID_STAGES.has(stage as RunnableStage)) {
    return c.json({ error: `stage desconocida: "${stage}"` }, 400);
  }
  const runnable = stage as RunnableStage;

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "started",
      data: JSON.stringify({ stage: runnable, slug, at: new Date().toISOString() }),
    });

    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: "running", data: JSON.stringify({ stage: runnable, slug }) }).catch(() => {});
    }, 2000);

    try {
      const lead = await runStage(slug, runnable);
      const links =
        runnable === "deploy"
          ? { dc_url: lead.generated.dc_url, web_url: lead.generated.web_url }
          : undefined;
      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ stage: runnable, status: lead.status, links }),
      });
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          stage: runnable,
          message: err instanceof Error ? err.message : String(err),
        }),
      });
    } finally {
      clearInterval(heartbeat);
    }
  });
});

/**
 * Links publicos del lead (dc_url/web_url, poblados por "deploy") + el mensaje
 * de contacto (front/back, poblado por "package"). El mensaje se persiste como
 * un unico string en `generated.outreach_message`; para pintarlo en dos bloques
 * re-derivamos las partes con `buildOutreachMessage` (pieza pura y determinista
 * sobre el lead). Solo se exponen si `package` ya corrio (outreach_message
 * presente), igual que los links dependen de que haya corrido "deploy".
 */
stagesRoutes.get("/leads/:slug/links", async (c) => {
  const slug = c.req.param("slug");
  if (!(await leadExists(slug))) return c.json({ error: "lead no existe" }, 404);
  const lead = await readLead(slug);
  const outreach = lead.generated.outreach_message ? buildOutreachMessage(lead) : null;
  return c.json({
    dc_url: lead.generated.dc_url ?? null,
    web_url: lead.generated.web_url ?? null,
    outreach_front: outreach?.front ?? null,
    outreach_back: outreach?.back ?? null,
  });
});

export default stagesRoutes;

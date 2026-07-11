import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Hono } from "hono";
import { leadExists, leadsRoot, readLead } from "../../lib/storage.js";
import { runIngestAndExtract } from "../services/pipeline.js";
import { saveUpload } from "../services/uploads.js";

const leadsRoutes = new Hono();

function formString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Slug de respaldo cuando el celular no manda uno: `uploads.ts` siempre
 * guarda el temp file como "front.<ext>"/"back.<ext>" (nombre estable, no el
 * original de la foto), asi que si `ingest` derivara el slug del PATH del
 * archivo, TODA subida caeria en el mismo slug "front" -- la segunda subida
 * real chocaria con "el lead ya existe". Unico + valido contra isValidSlug.
 */
function fallbackSlug(): string {
  return `lead-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

/** Lista liviana para la pantalla "Leads" (no el Lead completo, solo lo que se muestra en la card). */
leadsRoutes.get("/leads", async (c) => {
  let dirNames: string[];
  try {
    dirNames = await readdir(leadsRoot());
  } catch {
    return c.json([]); // leadsRoot todavia no existe: 0 leads, no es un error
  }

  const entries: { slug: string; status: string; name: string; rubro: string; updated_at: string }[] = [];
  for (const slug of dirNames) {
    if (!(await leadExists(slug))) continue; // carpeta sin data.json: no es un lead
    try {
      const lead = await readLead(slug);
      entries.push({
        slug: lead.slug,
        status: lead.status,
        name: lead.business.name || lead.slug,
        rubro: lead.rubro,
        updated_at: lead.meta.updated_at,
      });
    } catch {
      // data.json corrupto/no valida contra el schema: se salta, no rompe la lista entera
    }
  }
  entries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return c.json(entries);
});

/** Captura: multipart front(req)+back(opcional) -> ingest -> extract. */
leadsRoutes.post("/leads", async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: "body multipart invalido" }, 400);

  const front = form.get("front");
  const back = form.get("back");
  if (!(front instanceof File)) {
    return c.json({ error: "falta el archivo 'front'" }, 400);
  }

  let upload: Awaited<ReturnType<typeof saveUpload>>;
  try {
    upload = await saveUpload(front, back instanceof File ? back : undefined);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  try {
    const lead = await runIngestAndExtract({
      front: upload.frontPath,
      back: upload.backPath,
      slug: formString(form.get("slug")) ?? fallbackSlug(),
      rubro: formString(form.get("rubro")),
      channel: formString(form.get("channel")),
    });
    return c.json(lead);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  } finally {
    await upload.cleanup();
  }
});

leadsRoutes.get("/leads/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!(await leadExists(slug))) return c.json({ error: "lead no existe" }, 404);
  return c.json(await readLead(slug));
});

export default leadsRoutes;

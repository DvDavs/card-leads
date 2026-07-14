import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Hono } from "hono";
import { isValidSlug } from "../../lib/slug.js";
import { deleteLead, leadExists, leadsRoot, readLead } from "../../lib/storage.js";
import { runIngestAndExtract } from "../services/pipeline.js";
import { saveUpload } from "../services/uploads.js";

const leadsRoutes = new Hono();

/** Tamaño de página por defecto y máximo permitido para GET /leads. */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function formString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Parsea un entero de query string, cae al default si no es válido. */
function intParam(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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

/**
 * Lista liviana para la pantalla "Leads" (solo lo que se muestra en la card, no
 * el Lead completo). Pagina en el server para no mandar cientos de cards al
 * cliente de un jalón: acepta `page` (1-based), `pageSize`, y un filtro `q`
 * (busca en nombre/rubro/slug, case-insensitive). Devuelve `{ items, total,
 * page, pageSize, totalPages }` para que el front pinte los controles.
 */
leadsRoutes.get("/leads", async (c) => {
  const pageSize = Math.min(intParam(c.req.query("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const requestedPage = intParam(c.req.query("page"), 1);
  const q = (c.req.query("q") ?? "").trim().toLowerCase();

  let dirNames: string[];
  try {
    dirNames = await readdir(leadsRoot());
  } catch {
    // leadsRoot todavia no existe: 0 leads, no es un error
    return c.json({ items: [], total: 0, page: 1, pageSize, totalPages: 0 });
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

  const filtered = q
    ? entries.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.rubro.toLowerCase().includes(q) ||
          e.slug.toLowerCase().includes(q),
      )
    : entries;

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages); // clamp: nunca pedir mas alla del final
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return c.json({ items, total, page, pageSize, totalPages });
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

/**
 * Elimina un lead: borra su carpeta local completa (data.json + artefactos +
 * fotos). Valida el slug antes de tocar disco para blindar contra path
 * traversal (un `:slug` como "../otra-cosa" nunca pasa isValidSlug). No
 * despublica lo que ya viva en el server remoto; es un borrado del workspace
 * local del panel.
 */
leadsRoutes.delete("/leads/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isValidSlug(slug)) return c.json({ error: "slug invalido" }, 400);
  if (!(await leadExists(slug))) return c.json({ error: "lead no existe" }, 404);
  await deleteLead(slug);
  return c.json({ ok: true, slug });
});

export default leadsRoutes;

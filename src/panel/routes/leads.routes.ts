import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { Hono } from "hono";
import { SendStateSchema } from "../../lib/schema.js";
import { isValidSlug } from "../../lib/slug.js";
import { deleteLead, leadExists, leadsRoot, readLead } from "../../lib/storage.js";
import { resolveImagePath, listLeadImages } from "../services/images.js";
import { runIngestAndExtract } from "../services/pipeline.js";
import { DEFAULT_FOLDERS, TrackingError, updateTracking } from "../services/tracking.js";
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
interface LeadListItem {
  slug: string;
  status: string;
  name: string;
  rubro: string;
  updated_at: string;
  folder: string | null;
  send_state: string;
  created_by: string | null;
  sent_by: string | null;
}

/** Valor de carpeta usado en filtros/facetas para las tarjetas SIN carpeta. */
const NO_FOLDER = "(sin carpeta)";

leadsRoutes.get("/leads", async (c) => {
  const pageSize = Math.min(intParam(c.req.query("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const requestedPage = intParam(c.req.query("page"), 1);
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const folderFilter = (c.req.query("folder") ?? "").trim();
  const sendStateFilter = (c.req.query("sendState") ?? "").trim();

  let dirNames: string[];
  try {
    dirNames = await readdir(leadsRoot());
  } catch {
    // leadsRoot todavia no existe: 0 leads, no es un error
    return c.json({ items: [], total: 0, page: 1, pageSize, totalPages: 0, folders: [] });
  }

  const entries: LeadListItem[] = [];
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
        folder: lead.tracking?.folder ?? null,
        send_state: lead.tracking?.send_state ?? "draft",
        created_by: lead.tracking?.created_by ?? null,
        sent_by: lead.tracking?.sent_by ?? null,
      });
    } catch {
      // data.json corrupto/no valida contra el schema: se salta, no rompe la lista entera
    }
  }
  entries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  // Facetas de carpeta: se calculan sobre TODOS los leads (antes de filtrar) para
  // que los chips y sus conteos sean estables sin importar el filtro activo. Se
  // siembran las carpetas por defecto aunque tengan 0 tarjetas.
  const folderCounts = new Map<string, number>();
  for (const f of DEFAULT_FOLDERS) folderCounts.set(f, 0);
  for (const e of entries) {
    const key = e.folder ?? NO_FOLDER;
    folderCounts.set(key, (folderCounts.get(key) ?? 0) + 1);
  }
  const folders = [...folderCounts.entries()].map(([name, count]) => ({ name, count }));

  const filtered = entries.filter((e) => {
    if (q && !(e.name.toLowerCase().includes(q) || e.rubro.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q))) {
      return false;
    }
    if (folderFilter && (e.folder ?? NO_FOLDER) !== folderFilter) return false;
    if (sendStateFilter && e.send_state !== sendStateFilter) return false;
    return true;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages); // clamp: nunca pedir mas alla del final
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return c.json({ items, total, page, pageSize, totalPages, folders });
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
      createdBy: formString(form.get("created_by")),
      folder: formString(form.get("folder")),
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
 * Actualiza el tracking (carpeta / estado de envío / quién creó-envió) del lead.
 * Body: { folder?, send_state?, created_by?, sent_by?, actor? }. Todos
 * opcionales; solo se toca lo que venga. Al pasar send_state="sent" se estampa
 * sent_at y, si no viene sent_by, el `actor` (operador que hizo la acción).
 */
leadsRoutes.patch("/leads/:slug/tracking", async (c) => {
  const slug = c.req.param("slug");
  if (!(await leadExists(slug))) return c.json({ error: "lead no existe" }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "body invalido: se espera un objeto JSON" }, 400);
  }

  const patch: Parameters<typeof updateTracking>[1] = {};
  if ("folder" in body) patch.folder = body.folder === null ? null : String(body.folder);
  if ("created_by" in body) patch.created_by = body.created_by === null ? null : String(body.created_by);
  if ("sent_by" in body) patch.sent_by = body.sent_by === null ? null : String(body.sent_by);
  if (typeof body.actor === "string") patch.actor = body.actor;
  if ("send_state" in body) {
    const parsed = SendStateSchema.safeParse(body.send_state);
    if (!parsed.success) {
      return c.json({ error: `send_state invalido: "${String(body.send_state)}". Validos: ${SendStateSchema.options.join(", ")}` }, 422);
    }
    patch.send_state = parsed.data;
  }

  try {
    const lead = await updateTracking(slug, patch);
    return c.json(lead);
  } catch (err) {
    if (err instanceof TrackingError) return c.json({ error: err.message }, 422);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/** Lista las imágenes locales del lead (frente/reverso/logo/retrato) con su URL de servido. */
leadsRoutes.get("/leads/:slug/images", async (c) => {
  const slug = c.req.param("slug");
  if (!(await leadExists(slug))) return c.json({ error: "lead no existe" }, 404);
  const lead = await readLead(slug);
  const images = listLeadImages(lead).map((ref) => ({
    key: ref.key,
    label: ref.label,
    name: ref.rel,
    url: `/api/leads/${encodeURIComponent(slug)}/image/${ref.key}`,
  }));
  return c.json({ images });
});

/** Sirve los bytes de una imagen del lead. Resuelve DENTRO de la carpeta (anti traversal). */
leadsRoutes.get("/leads/:slug/image/:key", async (c) => {
  const slug = c.req.param("slug");
  const key = c.req.param("key");
  if (!isValidSlug(slug)) return c.json({ error: "slug invalido" }, 400);
  if (!(await leadExists(slug))) return c.json({ error: "lead no existe" }, 404);
  const resolved = await resolveImagePath(slug, key);
  if (!resolved) return c.json({ error: "imagen no encontrada" }, 404);
  const buf = await readFile(resolved.abs);
  return c.body(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, 200, {
    "content-type": resolved.mime,
    "cache-control": "private, max-age=60",
  });
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

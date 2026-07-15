import { promises as fs } from "node:fs";
import path from "node:path";
import type { Lead } from "../../lib/schema.js";
import { leadDir, readLead } from "../../lib/storage.js";

/**
 * images.ts — expone las imágenes LOCALES de un lead (las fotos de la tarjeta
 * que se subieron, más el logo/retrato si son archivos locales) para poder
 * verlas desde el panel. Resuelve siempre DENTRO de la carpeta del lead y
 * blinda contra path traversal: aunque la ruta salga de data.json, un
 * "../secreto" nunca se sirve.
 */

/** Claves servibles. Cada una mapea a un campo del lead con una ruta relativa. */
export type ImageKey = "front" | "back" | "logo" | "photo";

export interface ImageRef {
  key: ImageKey;
  label: string;
  /** nombre de archivo relativo dentro de la carpeta del lead. */
  rel: string;
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

/** Content-type por extensión; cae a octet-stream si es desconocida. */
export function mimeForPath(p: string): string {
  return MIME_BY_EXT[path.extname(p).toLowerCase()] ?? "application/octet-stream";
}

/**
 * ¿Es una ruta a un archivo LOCAL dentro del lead? Descarta data: URIs y URLs
 * remotas (logo_path/photo_path pueden ser cualquiera de las tres); esas no se
 * sirven por este endpoint (ya son accesibles tal cual).
 */
function isLocalRel(p: string | undefined): p is string {
  if (!p) return false;
  return !/^(data:|https?:|\/\/)/i.test(p);
}

/**
 * listLeadImages — función PURA: qué imágenes DECLARA el lead (no comprueba que
 * el archivo exista en disco; eso lo hace resolveImagePath al servir). front va
 * siempre; back/logo/photo solo si están declarados y son rutas locales.
 */
export function listLeadImages(lead: Lead): ImageRef[] {
  const refs: ImageRef[] = [{ key: "front", label: "Frente", rel: lead.source.card_front }];
  if (lead.source.card_back) refs.push({ key: "back", label: "Reverso", rel: lead.source.card_back });
  if (isLocalRel(lead.brand.logo_path)) {
    refs.push({ key: "logo", label: "Logo", rel: lead.brand.logo_path });
  }
  if (isLocalRel(lead.brand.photo_path)) {
    refs.push({ key: "photo", label: "Retrato / foto", rel: lead.brand.photo_path });
  }
  return refs;
}

/**
 * resolveImagePath — resuelve la ruta ABSOLUTA de una imagen del lead, o null si
 * la clave no existe / la ruta escapa de la carpeta / el archivo no está en
 * disco. Devuelve también el mime para el header de respuesta.
 */
export async function resolveImagePath(
  slug: string,
  key: string,
): Promise<{ abs: string; mime: string; rel: string } | null> {
  const lead = await readLead(slug);
  const ref = listLeadImages(lead).find((r) => r.key === key);
  if (!ref) return null;

  const dir = path.resolve(leadDir(slug));
  const abs = path.resolve(dir, ref.rel);
  // Guard anti path-traversal: el archivo DEBE quedar dentro de la carpeta del lead.
  if (abs !== dir && !abs.startsWith(dir + path.sep)) return null;

  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  return { abs, mime: mimeForPath(abs), rel: ref.rel };
}

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * uploads.ts — recibe archivos multipart (File del FormData que parsea Hono)
 * y los escribe a un directorio temporal, porque `ingest` toma RUTAS de
 * archivo, no buffers. `cleanup()` borra ese directorio entero (exito o
 * error) para no dejar fotos de tarjetas reales huerfanas en /tmp.
 */

export interface SavedUpload {
  dir: string;
  frontPath: string;
  backPath?: string;
  cleanup(): Promise<void>;
}

// Margen bajo el client_max_body_size de nginx (15MB, ver infra/nginx).
const MAX_BYTES = 12 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

async function saveFile(dir: string, name: string, file: File): Promise<string> {
  if (file.size === 0) throw new Error(`archivo "${name}" esta vacio`);
  if (file.size > MAX_BYTES) {
    throw new Error(`archivo "${name}" excede el limite de ${MAX_BYTES / 1024 / 1024}MB`);
  }
  const ext = MIME_EXT[file.type];
  if (!ext) {
    throw new Error(`archivo "${name}" tipo no permitido: "${file.type || "desconocido"}"`);
  }
  const dest = path.join(dir, `${name}${ext}`);
  await writeFile(dest, Buffer.from(await file.arrayBuffer()));
  return dest;
}

/** Guarda front (requerido) y back (opcional) en un temp dir nuevo. */
export async function saveUpload(front: File, back?: File | null): Promise<SavedUpload> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "card-leads-upload-"));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const frontPath = await saveFile(dir, "front", front);
    const backPath = back && back.size > 0 ? await saveFile(dir, "back", back) : undefined;
    return { dir, frontPath, backPath, cleanup };
  } catch (err) {
    await cleanup().catch(() => {});
    throw err;
  }
}

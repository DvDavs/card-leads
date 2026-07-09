import { promises as fs } from "node:fs";
import path from "node:path";
import { parseLead, type Lead } from "./schema.js";

/**
 * storage.ts — todo lo que toca el disco para un lead vive aca.
 * La raiz de leads es `LEADS_DIR` (env) o `<cwd>/leads`. El override por env
 * permite que los tests apunten a un directorio temporal aislado.
 */

export function leadsRoot(): string {
  return process.env.LEADS_DIR
    ? path.resolve(process.env.LEADS_DIR)
    : path.resolve(process.cwd(), "leads");
}

export function leadDir(slug: string): string {
  return path.join(leadsRoot(), slug);
}

export function dataFile(slug: string): string {
  return path.join(leadDir(slug), "data.json");
}

export async function leadExists(slug: string): Promise<boolean> {
  try {
    await fs.access(dataFile(slug));
    return true;
  } catch {
    return false;
  }
}

/** Lee y VALIDA data.json contra el schema Zod. Lanza si el JSON no cumple. */
export async function readLead(slug: string): Promise<Lead> {
  const raw = await fs.readFile(dataFile(slug), "utf8");
  return parseLead(JSON.parse(raw));
}

/**
 * Escribe data.json. Refresca meta.updated_at y valida antes de persistir,
 * asi nunca se guarda un lead que rompa el schema.
 */
export async function writeLead(lead: Lead): Promise<void> {
  const validated = parseLead({
    ...lead,
    meta: { ...lead.meta, updated_at: new Date().toISOString() },
  });
  await fs.mkdir(leadDir(validated.slug), { recursive: true });
  await fs.writeFile(
    dataFile(validated.slug),
    JSON.stringify(validated, null, 2) + "\n",
    "utf8",
  );
}

/** Copia un archivo dentro de la carpeta del lead y devuelve el nombre relativo. */
export async function copyIntoLead(
  slug: string,
  sourcePath: string,
  destName: string,
): Promise<string> {
  const dir = leadDir(slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(sourcePath, path.join(dir, destName));
  return destName; // ruta relativa que se guarda en source.card_front / card_back
}

/**
 * Copia RECURSIVAMENTE un arbol de directorios (ej. los assets compartidos de
 * los disenos guelaguetza) dentro de la carpeta del lead, en `destRelPath`
 * (relativo a la carpeta del lead, puede traer subcarpetas). Idempotente:
 * sobreescribe si ya existe. Si el origen no existe devuelve undefined sin
 * tocar disco (un pool sin assets no rompe el build). Devuelve la ruta
 * absoluta destino cuando copio algo.
 */
export async function copyTreeIntoLead(
  slug: string,
  sourceDir: string,
  destRelPath: string,
): Promise<string | undefined> {
  try {
    await fs.access(sourceDir);
  } catch {
    return undefined; // no hay assets que copiar
  }
  const dest = path.join(leadDir(slug), destRelPath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(sourceDir, dest, { recursive: true });
  return dest;
}

/**
 * Escribe un artefacto de texto (HTML, md) en la carpeta del lead. `fileName`
 * puede traer subcarpetas (ej. "dc/clinic.html", como hacen las digital
 * cards): se crea todo el arbol de directorios necesario, no solo la raiz
 * del lead.
 */
export async function writeArtifact(
  slug: string,
  fileName: string,
  content: string,
): Promise<string> {
  const full = path.join(leadDir(slug), fileName);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
  return full;
}

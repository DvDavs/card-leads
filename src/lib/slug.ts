/**
 * slug.ts — genera y valida slugs. Todo puro y determinista (testeable sin fs).
 */

/**
 * Convierte texto arbitrario en un slug kebab-case seguro para carpetas/URLs.
 * - Normaliza acentos (e-acute -> e), pasa a minusculas.
 * - Colapsa cualquier cosa no alfanumerica en un solo guion.
 * - Sin guiones al inicio/fin, sin guiones dobles.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD") // separa base + diacritico combinante
    .replace(/\p{Diacritic}/gu, "") // borra diacriticos combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // no-alfanumerico -> guion
    .replace(/-{2,}/g, "-") // colapsa guiones repetidos
    .replace(/^-+|-+$/g, ""); // recorta guiones de los bordes
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** true si `slug` ya esta en forma canonica (lo que produce slugify). */
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** Deriva un slug del nombre de archivo (sin extension ni carpetas). */
export function slugFromFilename(filePath: string): string {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  const noExt = base.replace(/\.[^.]+$/, "");
  return slugify(noExt);
}

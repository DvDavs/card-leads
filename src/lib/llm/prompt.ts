import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Carga el prompt de extraccion desde src/prompts/extract-card.md.
 * Se resuelve contra este archivo fuente (no contra el cwd) para que funcione
 * sin importar desde donde se corra el CLI. El prompt vive en .md a proposito:
 * iterarlo no requiere tocar codigo.
 */
export async function loadExtractPrompt(): Promise<string> {
  const url = new URL("../../prompts/extract-card.md", import.meta.url);
  return fs.readFile(fileURLToPath(url), "utf8");
}

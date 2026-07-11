import { buildCards } from "../../stages/build-cards.js";
import { buildWeb } from "../../stages/build-web.js";
import { deploy } from "../../stages/deploy.js";
import { enrich } from "../../stages/enrich.js";
import { extract } from "../../stages/extract.js";
import { ingest, type IngestOptions } from "../../stages/ingest.js";
import { readLead } from "../../lib/storage.js";
import type { Lead } from "../../lib/schema.js";

/**
 * pipeline.ts — capa fina sobre las stages existentes (mismo comportamiento,
 * cero reimplementacion) + un mutex EN MEMORIA por slug: dos requests sobre
 * el MISMO lead no deben pisarse un read-modify-write de data.json ni correr
 * dos deploys en paralelo peleando el manifest remoto. Un solo operador desde
 * un celular no deberia disparar dos requests a la vez sobre el mismo lead,
 * pero doble-tap existe -- esto es la insurance barata.
 *
 * Nota: el mutex vive en memoria del proceso. Alcanza porque el panel corre
 * como un unico proceso Node (systemd, sin cluster).
 */

const locks = new Map<string, Promise<unknown>>();

/** Encola `fn` detras de cualquier operacion pendiente sobre el mismo slug. */
export function withSlugLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(slug) ?? Promise.resolve();
  const chained = prev.then(fn, fn); // corre igual si la anterior tiro
  locks.set(slug, chained.catch(() => undefined)); // el mapa nunca guarda un rejected
  return chained;
}

/** ingest (crea el slug) + extract (LLM), encadenados y bajo lock del slug resultante. */
export async function runIngestAndExtract(opts: IngestOptions): Promise<Lead> {
  const ingested = await ingest(opts);
  return withSlugLock(ingested.slug, () => extract(ingested.slug));
}

export type RunnableStage = "build-cards" | "enrich" | "build-web" | "deploy";

/** Corre una stage por nombre, bajo lock del slug. Usado por el endpoint SSE (batch 4). */
export async function runStage(slug: string, stage: RunnableStage): Promise<Lead> {
  return withSlugLock(slug, async () => {
    switch (stage) {
      case "build-cards":
        await buildCards(slug);
        break;
      case "enrich":
        await enrich(slug);
        break;
      case "build-web":
        await buildWeb(slug);
        break;
      case "deploy":
        await deploy(slug);
        break;
    }
    // las stages devuelven distintas cosas (Lead, string[], string); releemos
    // el lead ya persistido para devolver siempre la misma forma al caller.
    return readLead(slug);
  });
}

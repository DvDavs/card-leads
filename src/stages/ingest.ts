import { promises as fs } from "node:fs";
import path from "node:path";
import { ChannelSchema, RubroSchema, type Channel, type Lead, type Rubro } from "../lib/schema.js";
import { isValidSlug, slugFromFilename } from "../lib/slug.js";
import { copyIntoLead, leadExists, writeLead } from "../lib/storage.js";

export interface IngestOptions {
  front: string; // ruta a la foto del frente (requerida)
  back?: string; // ruta a la foto del reverso (opcional)
  slug?: string; // override; si falta se deriva del nombre de archivo del frente
  rubro?: string; // override; default "otro"
  channel?: string; // "telegram" | "manual"; default "manual"
  force?: boolean; // sobreescribe un lead existente
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function extOf(p: string): string {
  const e = path.extname(p).toLowerCase();
  return e || ".jpg";
}

/**
 * ingest — primera etapa de la rebanada vertical.
 * Crea leads/<slug>/, copia las imagenes y escribe data.json con status="ingested".
 * NO extrae nada (eso es el LLM en `extract`): los campos van vacios y los huecos
 * quedan anotados en meta.needs para el human-in-loop.
 */
export async function ingest(opts: IngestOptions): Promise<Lead> {
  if (!opts.front) {
    throw new Error('ingest: falta la ruta de la foto del frente. Uso: ingest <front> [back]');
  }
  if (!(await fileExists(opts.front))) {
    throw new Error(`ingest: no existe el archivo de frente "${opts.front}"`);
  }
  if (opts.back && !(await fileExists(opts.back))) {
    throw new Error(`ingest: no existe el archivo de reverso "${opts.back}"`);
  }

  const slug = opts.slug ? opts.slug : slugFromFilename(opts.front);
  if (!isValidSlug(slug)) {
    throw new Error(
      `ingest: slug invalido "${slug}". Debe ser kebab-case [a-z0-9-]. Pasa --slug para fijarlo.`,
    );
  }

  if ((await leadExists(slug)) && !opts.force) {
    throw new Error(`ingest: el lead "${slug}" ya existe. Usa --force para sobreescribir.`);
  }

  // rubro: valida el override; si falta, "otro" y se anota como pendiente.
  const rubroRaw = opts.rubro ?? "otro";
  const rubroParsed = RubroSchema.safeParse(rubroRaw);
  if (!rubroParsed.success) {
    throw new Error(
      `ingest: rubro invalido "${rubroRaw}". Validos: ${RubroSchema.options.join(", ")}`,
    );
  }
  const rubro: Rubro = rubroParsed.data;

  const channelParsed = ChannelSchema.safeParse(opts.channel ?? "manual");
  if (!channelParsed.success) {
    throw new Error(`ingest: channel invalido "${opts.channel}". Validos: telegram, manual`);
  }
  const channel: Channel = channelParsed.data;

  // copia imagenes con nombres estables dentro de la carpeta del lead
  const cardFront = await copyIntoLead(slug, opts.front, `card_front${extOf(opts.front)}`);
  const cardBack = opts.back
    ? await copyIntoLead(slug, opts.back, `card_back${extOf(opts.back)}`)
    : undefined;

  // huecos que el humano/LLM debe resolver para avanzar
  const needs = ["extract: correr LLM para llenar business/contact"];
  if (!opts.rubro) needs.push("confirmar rubro (default: otro)");

  const lead: Lead = {
    slug,
    status: "ingested",
    rubro,
    source: {
      card_front: cardFront,
      ...(cardBack ? { card_back: cardBack } : {}),
      ingested_at: new Date().toISOString(),
      channel,
    },
    business: { name: "", attrs: {} },
    contact: {},
    socials: {},
    brand: { colors: {}, has_logo: false },
    content: { services: [] },
    generated: {},
    meta: { needs, errors: [], updated_at: new Date().toISOString() },
  };

  await writeLead(lead);
  return lead;
}

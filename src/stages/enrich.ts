import { rubroConfig } from "../config/rubro-map.js";
import { loadEnv } from "../lib/env.js";
import type { EnrichInput, Enrichment } from "../lib/llm/enrichment.js";
import { getProvider, resolveProviderName } from "../lib/llm/index.js";
import { StatusSchema, type GeneratedCopy, type Lead, type Status } from "../lib/schema.js";
import { readLead, writeLead } from "../lib/storage.js";

/**
 * enrich — etapa LLM que se inserta entre `verify` y `build-web`.
 *
 * Toma un lead YA verificado y genera el COPY de marketing (headlines, bio,
 * value props, FAQs, testimonios de ejemplo, CTA) a partir de los datos reales,
 * lo escribe en `content.generated_copy` y avanza el status a "enriched". El
 * copy se genera UNA vez y se persiste: build-web lo lee de disco, no regenera.
 *
 * Principios que respeta:
 *  - Los datos REALES (contacto, colores, servicios) son sagrados: el LLM no los
 *    toca. Solo produce prosa, separada en su propio bloque.
 *  - Los servicios reales (autoridad = verify) mandan: el LLM solo les pega una
 *    descripcion; cualquier descripcion cuyo nombre no matchee un servicio real
 *    se descarta.
 *  - El horario NO lo inventa el LLM: se rellena con el default DETERMINISTA por
 *    rubro (rubroConfig.defaultHours) y se anota en meta.needs para el humano.
 *  - Si el LLM falla / no parsea: registra en meta.errors y NO avanza el status
 *    (queda donde estaba, para reintentar), igual que `extract`.
 */

/** Devuelve el string util (sin null/undefined ni vacio tras trim), o undefined. */
function val(s: string | null | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

/** Normaliza un nombre de servicio para comparar (sin depender de mayus/espacios). */
function normName(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Prefijos de las anotaciones que MANEJA enrich en meta.needs. Se quitan antes
 * de re-agregarlas, para que re-correr enrich no las duplique (idempotente).
 */
const ENRICH_NEED_PREFIXES = [
  "horario sugerido por rubro",
  "testimonios de EJEMPLO",
  "revisar copy generado",
];

/**
 * applyEnrichment — funcion PURA: fusiona el copy generado sobre el Lead.
 *
 * - Escribe `content.generated_copy` (bloque separado de los datos reales).
 * - Mapea `service_descriptions` contra los servicios REALES: usa el nombre real
 *   (spelling y orden de verify) y descarta descripciones de servicios que no
 *   existen. Un servicio sin descripcion simplemente no aparece en la lista.
 * - Marca `testimonials` como EJEMPLO en `sample_fields`.
 * - Rellena `contact.hours` con el default por rubro si falta (determinista) y
 *   lo anota en meta.needs.
 * - Recalcula las anotaciones de enrich en meta.needs (idempotente) y limpia
 *   meta.errors (mapeo exitoso = arranque limpio).
 *
 * NO cambia status ni toca disco: eso es responsabilidad de enrich().
 * `now` (ISO) se pasa desde el caller para mantener la funcion determinista.
 */
export function applyEnrichment(lead: Lead, en: Enrichment, now: string): Lead {
  // service_descriptions: recorre los servicios REALES (autoridad), y a cada uno
  // le busca la descripcion que trajo el modelo. Nombre real, orden real; las
  // entradas del modelo que no matchean un servicio real se descartan.
  const byName = new Map(en.service_descriptions.map((d) => [normName(d.name), d.description]));
  const service_descriptions = lead.content.services
    .map((name) => ({ name, description: byName.get(normName(name)) }))
    .filter((d): d is { name: string; description: string } => Boolean(val(d.description)));

  const testimonials = en.testimonials.map((t) => ({
    quote: t.quote,
    author: t.author,
    ...(val(t.role) ? { role: val(t.role)! } : {}),
  }));
  const sampleFields = testimonials.length ? ["testimonials"] : [];

  const generated_copy: GeneratedCopy = {
    hero_headline: en.hero_headline,
    hero_subheadline: en.hero_subheadline,
    ...(val(en.hero_badge) ? { hero_badge: val(en.hero_badge)! } : {}),
    bio: en.bio,
    ...(val(en.pull_quote) ? { pull_quote: val(en.pull_quote)! } : {}),
    value_props: en.value_props,
    service_descriptions,
    faqs: en.faqs,
    testimonials,
    cta_headline: en.cta_headline,
    cta_subtext: en.cta_subtext,
    footer_tagline: en.footer_tagline,
    ...(val(en.meta_title) ? { meta_title: val(en.meta_title)! } : {}),
    ...(val(en.meta_description) ? { meta_description: val(en.meta_description)! } : {}),
    generated_at: now,
    ...(sampleFields.length ? { sample_fields: sampleFields } : {}),
  };

  // horario: default determinista por rubro cuando falta (NO lo inventa el LLM).
  const hoursDefault = val(rubroConfig(lead.rubro).defaultHours);
  const hadHours = Boolean(val(lead.contact.hours));
  const contact: Lead["contact"] =
    !hadHours && hoursDefault ? { ...lead.contact, hours: hoursDefault } : lead.contact;
  // El aviso persiste MIENTRAS el horario siga siendo el default del rubro (sin
  // confirmar): asi re-correr enrich no lo pierde, y desaparece recien cuando el
  // humano pone un horario propio (distinto del default).
  const hoursIsUnconfirmedDefault = Boolean(hoursDefault) && val(contact.hours) === hoursDefault;

  // meta.needs: quita las anotaciones que maneja enrich y las re-agrega segun el
  // estado actual (idempotente al re-correr).
  const needs = lead.meta.needs.filter(
    (n) => !ENRICH_NEED_PREFIXES.some((p) => n.startsWith(p)),
  );
  if (hoursIsUnconfirmedDefault) {
    needs.push("horario sugerido por rubro (no estaba en la tarjeta), confirmar/ajustar");
  }
  if (sampleFields.includes("testimonials")) {
    needs.push("testimonios de EJEMPLO generados, reemplazar por reales antes de publicar");
  }
  needs.push("revisar copy generado (bio, FAQs, headlines) antes de publicar");

  return {
    ...lead,
    contact,
    content: { ...lead.content, generated_copy },
    meta: { ...lead.meta, needs, errors: [] },
  };
}

/**
 * enrich — etapa CLI. Exige status "verified" o posterior (guard tolerante, como
 * build-cards: la rama del copy web no debe acoplarse a la de digital cards).
 * Llama al proveedor LLM, valida la salida y, si parsea, escribe el copy y avanza
 * a "enriched" (sin retroceder si el lead ya estaba mas adelante). Si la respuesta
 * no parsea, registra el error en meta.errors y NO avanza el status.
 */
export async function enrich(slug: string): Promise<Lead> {
  if (!slug) throw new Error("enrich: falta el slug. Uso: enrich <slug>");
  loadEnv();

  const lead = await readLead(slug);
  const order = StatusSchema.options;
  const isEnrichable =
    lead.status !== "error" && order.indexOf(lead.status) >= order.indexOf("verified");
  if (!isEnrichable) {
    const hint =
      lead.status === "ingested" || lead.status === "extracted"
        ? `Corre 'verify ${slug}' primero.`
        : "";
    throw new Error(
      `enrich: el lead "${slug}" esta en status "${lead.status}" y se requiere "verified" o posterior. ${hint}`,
    );
  }

  const providerName = resolveProviderName();
  const provider = await getProvider(providerName);

  const input: EnrichInput = {
    rubro: lead.rubro,
    businessName: lead.business.name,
    ...(val(lead.business.person_name) ? { personName: val(lead.business.person_name)! } : {}),
    ...(val(lead.business.tagline) ? { tagline: val(lead.business.tagline)! } : {}),
    services: lead.content.services,
    ...(val(lead.contact.address) ? { location: val(lead.contact.address)! } : {}),
  };

  const result = await provider.enrichCopy(input);

  if (!result.ok) {
    // No se escribe copy basura: solo se registra el error y el status queda
    // como estaba para poder reintentar.
    const failed: Lead = {
      ...lead,
      meta: { ...lead.meta, errors: [...lead.meta.errors, `enrich(${providerName}): ${result.error}`] },
    };
    await writeLead(failed);
    throw new Error(
      `enrich: la respuesta del modelo no parseo. Se registro en meta.errors. Detalle: ${result.error}`,
    );
  }

  const applied = applyEnrichment(lead, result.data, new Date().toISOString());
  // Avanza a "enriched" solo si el lead no estaba ya mas adelante (no retrocede).
  const status: Status =
    order.indexOf(lead.status) < order.indexOf("enriched") ? "enriched" : lead.status;

  const enriched: Lead = { ...applied, status };
  await writeLead(enriched);
  return enriched;
}

import { z } from "zod";

/**
 * enrichment.ts — el CONTRATO de la salida del modelo para la etapa `enrich`.
 *
 * A diferencia de `extraction.ts` (el modelo LEE una foto y transcribe lo que
 * ve), aca el modelo GENERA copy de marketing a partir de datos YA verificados.
 * Por eso los campos narrativos son requeridos (`.min(1)`): esperamos que el
 * modelo los produzca. Las LISTAS usan `.default([])` para que una generacion
 * levemente incompleta siga siendo usable en vez de fallar entera; los extras
 * (badge, quote, meta_*) son `.nullish()`.
 *
 * Este schema NO incluye `generated_at` ni `sample_fields`: esos los agrega la
 * etapa (codigo determinista), no el modelo. El schema completo persistido es
 * `GeneratedCopySchema` (ver lib/schema.ts).
 *
 * El modelo NO devuelve datos de contacto, numeros duros (stats) ni
 * credenciales: eso lo prohibe el prompt (write-copy.md) y aca ni siquiera hay
 * campos para ello (Zod descarta claves desconocidas).
 */

const str = z.string();
const nstr = z.string().nullish();

export const EnrichmentSchema = z.object({
  hero_headline: str.min(1),
  hero_subheadline: str.min(1),
  hero_badge: nstr,
  bio: str.min(1),
  pull_quote: nstr,
  value_props: z.array(z.object({ title: str, description: str })).default([]),
  service_descriptions: z.array(z.object({ name: str, description: str })).default([]),
  faqs: z.array(z.object({ question: str, answer: str })).default([]),
  testimonials: z
    .array(z.object({ quote: str, author: str, role: nstr }))
    .default([]),
  cta_headline: str.min(1),
  cta_subtext: str.min(1),
  footer_tagline: str.min(1),
  meta_title: nstr,
  meta_description: nstr,
});

/** La forma validada que devuelven TODOS los proveedores por igual. */
export type Enrichment = z.infer<typeof EnrichmentSchema>;

/**
 * EnrichInput — los datos VERIFICADOS que se le pasan al modelo como contexto.
 * Solo lo necesario para redactar copy plausible; nunca se le pide inventar
 * contacto, asi que los telefonos/emails/redes NO viajan aca (los templates ya
 * los tienen del lead real).
 */
export interface EnrichInput {
  rubro: string;
  businessName: string;
  personName?: string;
  tagline?: string;
  services: string[]; // servicios REALES (autoridad = verify)
  location?: string; // direccion, para dar color local al copy
}

/** Resultado del parseo: nunca lanza, enruta el error para meta.errors. */
export type EnrichmentResult =
  | { ok: true; data: Enrichment; raw: string }
  | { ok: false; error: string; raw: string };

/** Desenvuelve ```json ... ``` si el modelo lo mando con fences pese al pedido. */
function stripFences(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fence ? fence[1]!.trim() : t;
}

/**
 * parseEnrichment — funcion PURA y determinista: texto crudo del modelo ->
 * Enrichment validada, o un error legible. Unico lugar donde se valida la
 * salida, sin importar el proveedor. NUNCA lanza: los fallos van al campo error
 * para que la etapa `enrich` los registre en meta.errors sin escribir basura.
 */
export function parseEnrichment(raw: string): EnrichmentResult {
  const cleaned = stripFences(raw);

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: `la respuesta no es JSON valido: ${cleaned.slice(0, 200)}`, raw };
  }

  const parsed = EnrichmentSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `el JSON no cumple el schema: ${detail}`, raw };
  }

  return { ok: true, data: parsed.data, raw };
}

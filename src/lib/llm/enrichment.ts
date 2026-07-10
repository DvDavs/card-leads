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

/**
 * DemoSchema — el bloque de contenido de MUESTRA (ficticio) que el modelo GENERA
 * para la web demo comercial: stats de vitrina, equipo, trayectoria, educacion,
 * investigacion, mision, higiene, confianza, etc. Es la contraparte "con forma
 * fija" del copy libre y su unica excepcion a la regla "sin numeros/credenciales"
 * (ver write-copy.md, seccion DEMO): aca SI hay numeros modestos y credenciales
 * genericas, pero TODO es de ejemplo y se marca como tal (sample_fields "demo").
 *
 * Espeja la forma de DemoContentSchema (lib/schema.ts). Las LISTAS usan
 * `.default([])` y los objetos/escalares sueltos son `.nullish()`: una generacion
 * parcial NO tumba el parseo, solo trae menos bloques. El bloque `demo` entero es
 * `.optional()` para back-compat: respuestas viejas SIN `demo` siguen validando.
 */
const DemoSchema = z.object({
  stats: z.array(z.object({ value: str, label: str })).default([]),
  team: z.array(z.object({ name: str, role: str, gender: z.enum(["m", "f"]) })).default([]),
  experience: z
    .array(
      z.object({
        role: str,
        place: str,
        period: str,
        description: str,
        current: z.boolean().default(false),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        degree: str,
        institution: str,
        period: str,
        details: z.array(str).default([]),
      }),
    )
    .default([]),
  research: z.array(z.object({ tag: str, title: str, description: str })).default([]),
  skills: z.array(str).default([]),
  languages: z.array(z.object({ language: str, level: str })).default([]),
  mission: nstr,
  patient_education: z.array(z.object({ title: str, description: str })).default([]),
  sedation: z.object({ title: str, description: str, points: z.array(str).default([]) }).nullish(),
  hygiene: z.array(z.object({ title: str, description: str })).default([]),
  urgency: z.object({ headline: str, subtext: str }).nullish(),
  availability_badge: nstr,
  rating: z.object({ value: str, count_label: str }).nullish(),
  trust_items: z.array(str).default([]),
});

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
  // demo: contenido de MUESTRA con forma fija para la web demo. Opcional =>
  // respuestas de modelo previas a esta pieza siguen parseando (back-compat).
  demo: DemoSchema.optional(),
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
  // personGender: genero de LA PERSONA del negocio. Se usa SOLO para la
  // concordancia del copy ("el doctor" / "la doctora") y para balancear el
  // genero del equipo de MUESTRA (demo.team). No es un dato de contacto.
  personGender?: "m" | "f";
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

import { z } from "zod";
import { RubroSchema } from "../schema.js";

/**
 * extraction.ts — el CONTRATO de la salida del modelo de vision.
 *
 * Es un schema aparte del Lead a proposito. No usamos LeadSchema.partial()
 * porque partial() solo afloja el PRIMER nivel: `business` seguiria exigiendo
 * `name`, `brand` seguiria exigiendo `has_logo`, etc. El modelo llena solo lo
 * que ve en la tarjeta, asi que necesitamos opcionalidad PROFUNDA. Ademas el
 * modelo no debe (ni puede) devolver campos de infraestructura como slug,
 * status, source o meta; este schema los deja fuera por completo.
 *
 * Todo campo es .nullish() (acepta null y undefined) porque el prompt le pide
 * al modelo devolver null para lo que no ve; esos null se tratan como ausentes
 * al mapear (ver applyExtraction). Zod descarta claves desconocidas por default,
 * asi que si el modelo inventa un campo extra, se ignora en vez de romper.
 */
const str = z.string().nullish();

export const ExtractionSchema = z.object({
  business: z
    .object({
      name: str,
      person_name: str,
      tagline: str,
    })
    .nullish(),
  // el modelo puede sugerir/corregir el rubro que se puso al ingerir
  rubro: RubroSchema.nullish(),
  contact: z
    .object({
      phones: z.array(z.string()).nullish(), // varios telefonos posibles
      whatsapp: str, // WhatsApp es uno solo
      email: str,
      address: str,
      website: str,
    })
    .nullish(),
  socials: z
    .object({
      facebook: str,
      instagram: str,
      tiktok: str,
    })
    .nullish(),
  // Los hex se MIDEN de los pixeles con colorthief (ver lib/colors); el modelo NO
  // los estima. Aca el LLM solo aporta has_logo y font_hint.
  brand: z
    .object({
      has_logo: z.boolean().nullish(),
      font_hint: str,
    })
    .nullish(),
  // colors: ASIGNACION de roles. Al modelo se le pasa la paleta MEDIDA y elige,
  // con vision, que hex de esa lista va en cada rol. No inventa hex: la baranda
  // `resolveAssignedColors` descarta cualquier hex que no este en la paleta. Todo
  // .nullish(): un rol sin buen candidato en la paleta queda null.
  colors: z
    .object({
      primary: str,
      secondary: str,
      accent: str,
      background: str,
      surface: str,
      text: str,
    })
    .nullish(),
  content: z
    .object({
      services: z.array(z.string()).nullish(),
    })
    .nullish(),
});

/** La forma validada que devuelven TODOS los proveedores por igual. */
export type Extraction = z.infer<typeof ExtractionSchema>;

/** Resultado del parseo: nunca lanza, enruta el error para meta.errors. */
export type ExtractionResult =
  | { ok: true; data: Extraction; raw: string }
  | { ok: false; error: string; raw: string };

/** Desenvuelve ```json ... ``` si el modelo lo mando con fences pese al pedido. */
function stripFences(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fence ? fence[1]!.trim() : t;
}

/**
 * parseExtraction — funcion PURA y determinista: texto crudo del modelo ->
 * Extraction validada, o un error legible. Es el unico lugar donde se valida la
 * salida, sin importar el proveedor. NUNCA lanza: los fallos van al campo error
 * para que la etapa `extract` los registre en meta.errors sin escribir basura.
 */
export function parseExtraction(raw: string): ExtractionResult {
  const cleaned = stripFences(raw);

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: `la respuesta no es JSON valido: ${cleaned.slice(0, 200)}`, raw };
  }

  const parsed = ExtractionSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `el JSON no cumple el schema: ${detail}`, raw };
  }

  return { ok: true, data: parsed.data, raw };
}

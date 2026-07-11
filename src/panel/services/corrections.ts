import { parseLead, type Lead } from "../../lib/schema.js";
import { readLead, writeLead } from "../../lib/storage.js";
import { applyCorrection, finalizeVerified, setAttr, type LeadFieldPath } from "../../stages/verify.js";
import { withSlugLock } from "./pipeline.js";

/**
 * corrections.ts — el nucleo del reemplazo de la pantalla verify interactiva.
 * NO reimplementa la logica de edicion: reusa applyCorrection/setAttr/
 * finalizeVerified de src/stages/verify.ts tal cual (son puras). Esta capa
 * solo decide QUE funcion pura llamar segun la forma del campo que manda el
 * celular, y hace el load -> transform -> re-validate -> persist.
 */

export class CorrectionError extends Error {}

export type CorrectionValue = string | string[] | null;

const VALID_FIELD_PATHS = new Set<LeadFieldPath>([
  "business.name",
  "business.person_name",
  "business.tagline",
  "business.person_gender",
  "rubro",
  "contact.phones",
  "contact.whatsapp",
  "contact.email",
  "contact.address",
  "socials.facebook",
  "socials.instagram",
  "socials.tiktok",
  "brand.colors.primary",
  "brand.colors.secondary",
  "brand.colors.accent",
  "brand.colors.background",
  "brand.colors.surface",
  "brand.colors.text",
  "content.services",
]);

const ATTR_PREFIX = "attr:";

/**
 * Mapea {field, value} a la funcion pura correcta, SIN tocar disco:
 * - "attr:<key>"  -> credencial dinamica en business.attrs -> setAttr
 * - LeadFieldPath -> applyCorrection
 * Cualquier otro path, o un value con forma invalida para ese campo, tira
 * CorrectionError (el caller la mapea a HTTP 422).
 */
export function applyOneCorrection(lead: Lead, field: string, value: CorrectionValue): Lead {
  if (field.startsWith(ATTR_PREFIX)) {
    const key = field.slice(ATTR_PREFIX.length);
    if (!key) throw new CorrectionError("attr: falta la clave, ej. \"attr:cedula\"");
    if (Array.isArray(value)) throw new CorrectionError("attr: el valor no puede ser una lista");
    return setAttr(lead, key, value);
  }
  if (!VALID_FIELD_PATHS.has(field as LeadFieldPath)) {
    throw new CorrectionError(`campo desconocido: "${field}"`);
  }
  try {
    return applyCorrection(lead, field as LeadFieldPath, value);
  } catch (err) {
    // applyCorrection tira en rubro/gender fuera del enum -- se propaga como
    // CorrectionError (422) en vez de 500, es un error de INPUT del usuario.
    throw new CorrectionError(err instanceof Error ? err.message : String(err));
  }
}

/** Carga el lead, aplica UNA correccion, re-valida y persiste. Serializado por slug. */
export async function correctField(
  slug: string,
  field: string,
  value: CorrectionValue,
): Promise<Lead> {
  return withSlugLock(slug, async () => {
    const lead = await readLead(slug);
    const next = applyOneCorrection(lead, field, value);
    let validated: Lead;
    try {
      validated = parseLead(next);
    } catch (err) {
      throw new CorrectionError(err instanceof Error ? err.message : String(err));
    }
    await writeLead(validated);
    return validated;
  });
}

/**
 * Cierra el checkpoint de verificacion: requiere status "extracted" (mismo
 * guard que la verify() interactiva). Si ya esta "verified" es un no-op
 * idempotente (reintentos del celular no rompen nada).
 */
export async function finalizeLeadVerification(slug: string): Promise<Lead> {
  return withSlugLock(slug, async () => {
    const lead = await readLead(slug);
    if (lead.status === "verified") return lead;
    if (lead.status !== "extracted") {
      throw new CorrectionError(
        `no se puede finalizar: status actual es "${lead.status}" (se espera "extracted")`,
      );
    }
    const finalized = finalizeVerified(lead);
    let validated: Lead;
    try {
      validated = parseLead(finalized);
    } catch (err) {
      throw new CorrectionError(err instanceof Error ? err.message : String(err));
    }
    await writeLead(validated);
    return validated;
  });
}

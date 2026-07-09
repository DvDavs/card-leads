import path from "node:path";
import {
  BRAND_ROLES,
  SURFACE_ROLES,
  extractBrandColors,
  extractPalette,
  resolveAssignedColors,
  type ExtractedBrandColors,
} from "../lib/colors.js";
import { loadEnv } from "../lib/env.js";
import type { Extraction } from "../lib/llm/extraction.js";
import { getProvider, resolveProviderName } from "../lib/llm/index.js";
import type { Lead, Rubro } from "../lib/schema.js";
import { leadDir, readLead, writeLead } from "../lib/storage.js";

/** Devuelve el string util (sin null/undefined ni vacio tras trim), o undefined. */
function val(s: string | null | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

/**
 * computeNeeds — recalcula los huecos que quedan para el checkpoint humano.
 * Se recalcula entero (no se hace diff) para que refleje el estado real tras la
 * extraccion. Cada campo que el modelo no pudo determinar queda anotado aca.
 */
function computeNeeds(lead: Lead, originalRubro: Rubro, modelRubro: Rubro | null | undefined): string[] {
  const needs: string[] = [];

  if (!val(lead.business.name)) needs.push("falta nombre del negocio");
  const noPhone = !(lead.contact.phones && lead.contact.phones.length);
  if (noPhone && !val(lead.contact.whatsapp)) needs.push("falta telefono / whatsapp");
  if (!val(lead.contact.email)) needs.push("falta email");
  if (!val(lead.contact.address)) needs.push("falta direccion");

  const noSocials = !lead.socials.facebook && !lead.socials.instagram && !lead.socials.tiktok;
  if (noSocials) needs.push("faltan redes sociales");

  const noColors =
    !lead.brand.colors.primary && !lead.brand.colors.secondary && !lead.brand.colors.accent;
  // colorthief no pudo medir colores (imagen rara o solo texto sobre blanco):
  // no es un error, el humano los revisa/carga a mano en verify.
  if (noColors) needs.push("revisar colores en verify");

  if (lead.content.services.length === 0) needs.push("faltan servicios");

  if (lead.rubro === "otro") {
    needs.push("confirmar rubro (sigue en 'otro')");
  } else if (modelRubro && modelRubro !== originalRubro) {
    needs.push(`revisar rubro: al ingerir='${originalRubro}', el modelo sugiere='${modelRubro}'`);
  }

  // checkpoint: extract NO avanza mas alla de "extracted"; el humano valida y
  // luego corre `verify`.
  needs.push("revision humana: validar datos y correr `verify`");
  return needs;
}

/**
 * applyExtraction — funcion PURA: fusiona lo que leyo el modelo sobre el Lead.
 *
 * Reglas de fusion:
 * - Solo pisa un campo si el modelo trajo un valor util. Un null/vacio del
 *   modelo NO borra lo que ya tenia el lead (no se pierde dato bueno).
 * - `has_logo` es booleano: se toma el del modelo solo si vino como boolean.
 * - `rubro` se corrige con el del modelo cuando lo trae (puede enmendar el que
 *   se puso al ingerir); el cambio queda anotado en meta.needs para revision.
 * - Los COLORES ya no vienen del modelo: se miden con colorthief y entran por el
 *   parametro `brandColors`. Si vino vacio (colorthief fallo o no detecto nada),
 *   los colores quedan vacios y computeNeeds lo anota como pendiente.
 * - Recalcula meta.needs y limpia meta.errors (mapeo exitoso = arranque limpio).
 *
 * NO cambia status ni toca disco: eso es responsabilidad de extract().
 */
export function applyExtraction(
  lead: Lead,
  ex: Extraction,
  brandColors: ExtractedBrandColors = {},
  palette: string[] = [],
): Lead {
  const originalRubro = lead.rubro;
  const b = ex.business ?? {};
  const c = ex.contact ?? {};
  const s = ex.socials ?? {};
  const brand = ex.brand ?? {};

  const business: Lead["business"] = {
    ...lead.business,
    name: val(b.name) ?? lead.business.name,
    ...(val(b.person_name) ? { person_name: val(b.person_name)! } : {}),
    ...(val(b.tagline) ? { tagline: val(b.tagline)! } : {}),
  };

  const phones = (c.phones ?? []).map((v) => v.trim()).filter(Boolean);
  const contact: Lead["contact"] = {
    ...lead.contact,
    ...(phones.length ? { phones } : {}),
    ...(val(c.whatsapp) ? { whatsapp: val(c.whatsapp)! } : {}),
    ...(val(c.email) ? { email: val(c.email)! } : {}),
    ...(val(c.address) ? { address: val(c.address)! } : {}),
    ...(val(c.website) ? { website: val(c.website)! } : {}),
  };

  const socials: Lead["socials"] = {
    ...lead.socials,
    ...(val(s.facebook) ? { facebook: val(s.facebook)! } : {}),
    ...(val(s.instagram) ? { instagram: val(s.instagram)! } : {}),
    ...(val(s.tiktok) ? { tiktok: val(s.tiktok)! } : {}),
  };

  // colores por ROL: el hex sale de `palette` (medida por colorthief) y la
  // ASIGNACION del rol la trae `brandColors`, ya validada (LLM eligiendo de la
  // paleta, o la heuristica de fallback). Es la autoridad, asi que se REEMPLAZA
  // (no se fusiona): al llegar aca el lead recien ingerido los trae vacios.
  // colorsText (texto legible) solo para roles de superficie; `text` es tinta.
  const colorsOut: Lead["brand"]["colors"] = {};
  for (const role of BRAND_ROLES) {
    const bc = brandColors[role];
    if (bc) colorsOut[role] = bc.hex;
  }
  const colorsTextOut: NonNullable<Lead["brand"]["colorsText"]> = {};
  for (const role of SURFACE_ROLES) {
    const bc = brandColors[role];
    if (bc?.textColor) colorsTextOut[role] = bc.textColor;
  }

  const brandOut: Lead["brand"] = {
    ...lead.brand,
    ...(palette.length ? { palette } : {}),
    colors: colorsOut,
    colorsText: colorsTextOut,
    has_logo: typeof brand.has_logo === "boolean" ? brand.has_logo : lead.brand.has_logo,
    ...(val(brand.font_hint) ? { font_hint: val(brand.font_hint)! } : {}),
  };

  const services = (ex.content?.services ?? []).map((v) => v.trim()).filter(Boolean);
  const content: Lead["content"] = {
    ...lead.content,
    services: services.length ? services : lead.content.services,
  };

  const rubro: Rubro = ex.rubro ?? lead.rubro;

  const merged: Lead = {
    ...lead,
    rubro,
    business,
    contact,
    socials,
    brand: brandOut,
    content,
  };

  return {
    ...merged,
    meta: {
      ...lead.meta,
      needs: computeNeeds(merged, originalRubro, ex.rubro),
      errors: [],
    },
  };
}

/**
 * extract — segunda etapa LLM de la rebanada.
 * Lee data.json (debe estar en "ingested"), manda las fotos al proveedor de
 * vision (LLM_PROVIDER), valida la salida con el schema y, si parsea, escribe
 * los datos y avanza a "extracted". Aca hay CHECKPOINT humano: NO avanza mas.
 * Si la respuesta no parsea, registra el error en meta.errors y NO escribe basura.
 */
export async function extract(slug: string): Promise<Lead> {
  if (!slug) throw new Error("extract: falta el slug. Uso: extract <slug>");
  loadEnv();

  const lead = await readLead(slug);
  if (lead.status !== "ingested") {
    throw new Error(
      `extract: el lead "${slug}" esta en status "${lead.status}", se esperaba "ingested". ` +
        "Vuelve a ingerir con --force para re-extraer.",
    );
  }

  const providerName = resolveProviderName();
  const provider = await getProvider(providerName);

  const dir = leadDir(slug);
  const front = path.join(dir, lead.source.card_front);
  const back = lead.source.card_back ? path.join(dir, lead.source.card_back) : undefined;

  // 1) MEDIR la paleta (colorthief, deterministico). Se mide ANTES de llamar al
  // modelo porque se le pasa como contexto para que ASIGNE roles de color. Nunca
  // crashea el pipeline: si la imagen es rara y colorthief/sharp lanza, se atrapa
  // y la paleta queda vacia (el modelo no asigna colores y se cae a la heuristica).
  let palette: string[] = [];
  try {
    palette = await extractPalette(front, back);
  } catch (err) {
    console.warn(
      `extract: colorthief no pudo medir la paleta (${
        err instanceof Error ? err.message : String(err)
      }). Se sigue sin colores medidos.`,
    );
  }

  // 2) LLM: extrae el texto Y asigna roles de color eligiendo de la paleta medida.
  const result = await provider.extractCard(front, back, palette);

  if (!result.ok) {
    // No se escribe basura: solo se registra el error y el status queda en
    // "ingested" para poder reintentar.
    const failed: Lead = {
      ...lead,
      meta: { ...lead.meta, errors: [...lead.meta.errors, `extract(${providerName}): ${result.error}`] },
    };
    await writeLead(failed);
    throw new Error(
      `extract: la respuesta del modelo no parseo. Se registro en meta.errors. Detalle: ${result.error}`,
    );
  }

  // 3) COLORES: manda la asignacion del LLM, validada contra la paleta (baranda:
  // solo hex realmente medidos, nunca inventados). Si el LLM no asigno ningun
  // color valido (o no hubo paleta), se cae a la heuristica de peso de marca sobre
  // los pixeles. Nunca crashea el pipeline: si tambien falla, quedan vacios y
  // computeNeeds lo marca como pendiente para cargar a mano en verify.
  let brandColors: ExtractedBrandColors = resolveAssignedColors(result.data.colors ?? {}, palette);
  if (Object.keys(brandColors).length === 0) {
    try {
      brandColors = await extractBrandColors(front, back);
    } catch (err) {
      console.warn(
        `extract: fallback de color (heuristica) fallo (${
          err instanceof Error ? err.message : String(err)
        }). Se dejan vacios para cargar a mano en verify.`,
      );
    }
  }

  const extracted: Lead = {
    ...applyExtraction(lead, result.data, brandColors, palette),
    status: "extracted",
  };
  await writeLead(extracted);
  return extracted;
}

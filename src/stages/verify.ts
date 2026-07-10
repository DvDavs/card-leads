import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { SURFACE_ROLES, textColorFor } from "../lib/colors.js";
import { parseLead, RubroSchema, type Lead, type Rubro } from "../lib/schema.js";
import { readLead, writeLead } from "../lib/storage.js";

/**
 * verify — CHECKPOINT humano interactivo en la terminal. NO usa LLM.
 *
 * Recorre los campos que extrajo el modelo barato y deja que el humano los
 * confirme o corrija uno por uno. El modelo barato falla justo en los campos
 * "de riesgo" (telefonos con un digito cambiado, handles inventados, hex
 * aproximados), asi que esos se muestran PRIMERO y marcados para forzar la
 * revision contra la tarjeta fisica.
 *
 * La logica de "aplicar una correccion a un campo" (applyCorrection) y la de
 * cerrar el lead (finalizeVerified) son funciones PURAS y testeables: aca solo
 * vive la orquestacion de readline (I/O), que no se testea.
 */

/** Palabra clave para vaciar un campo (el usuario la escribe en vez de un valor). */
const CLEAR_KEY = "-";

/** Los rubros validos, derivados del enum (unica fuente de verdad). */
const RUBROS = RubroSchema.options;

/** Rutas de los campos editables del Lead. El string es la "direccion" del campo. */
export type LeadFieldPath =
  | "business.name"
  | "business.person_name"
  | "business.tagline"
  | "rubro"
  | "contact.phones"
  | "contact.whatsapp"
  | "contact.email"
  | "contact.address"
  | "socials.facebook"
  | "socials.instagram"
  | "socials.tiktok"
  | "brand.colors.primary"
  | "brand.colors.secondary"
  | "brand.colors.accent"
  | "brand.colors.background"
  | "brand.colors.surface"
  | "brand.colors.text"
  | "content.services";

/** Util (sin vacio tras trim), o undefined. Misma semantica que en extract. */
function val(s: string | null | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

/** Normaliza el valor entrante de un campo string: null/vacio => undefined (vaciar). */
function normStr(value: string | string[] | null): string | undefined {
  if (value === null) return undefined;
  const raw = Array.isArray(value) ? value.join(", ") : value;
  return val(raw);
}

/** Normaliza una lista: acepta array o string separado por comas; recorta y filtra vacios. */
function normList(value: string | string[] | null): string[] {
  if (value === null) return [];
  const items = Array.isArray(value) ? value : value.split(",");
  return items.map((s) => s.trim()).filter(Boolean);
}

/** Parsea/valida un rubro. Lanza si esta fuera del enum, para que el caller re-pregunte. */
function parseRubro(value: string | string[] | null): Rubro {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = RubroSchema.safeParse(candidate?.trim());
  if (!parsed.success) {
    throw new Error(`rubro invalido: "${String(candidate)}". Validos: ${RUBROS.join(", ")}`);
  }
  return parsed.data;
}

// Pequenos updaters inmutables por grupo, para no repetir el spread anidado.
function withBusiness(lead: Lead, patch: Partial<Lead["business"]>): Lead {
  return { ...lead, business: { ...lead.business, ...patch } };
}
function withContact(lead: Lead, patch: Partial<Lead["contact"]>): Lead {
  return { ...lead, contact: { ...lead.contact, ...patch } };
}
function withSocials(lead: Lead, patch: Partial<Lead["socials"]>): Lead {
  return { ...lead, socials: { ...lead.socials, ...patch } };
}
function withColors(lead: Lead, patch: Partial<Lead["brand"]["colors"]>): Lead {
  return { ...lead, brand: { ...lead.brand, colors: { ...lead.brand.colors, ...patch } } };
}

/**
 * applyCorrection — funcion PURA: aplica una correccion a UN campo del Lead.
 *
 * Contrato:
 * - `value` string  -> setea el campo (recortado).
 * - `value` null    -> vacia el campo. En los opcionales lo deja en undefined
 *                      (se omite al serializar); en `business.name` (requerido)
 *                      lo deja en "".
 * - `value` string[]-> solo para `content.services` (la lista).
 * - `rubro` fuera del enum -> LANZA (el caller interactivo re-pregunta).
 *
 * Nunca muta el lead de entrada: devuelve uno nuevo. No toca status ni disco.
 */
export function applyCorrection(
  lead: Lead,
  field: LeadFieldPath,
  value: string | string[] | null,
): Lead {
  switch (field) {
    // requerido: vaciar => "" (el schema exige string, no opcional)
    case "business.name":
      return withBusiness(lead, { name: normStr(value) ?? "" });
    case "business.person_name":
      return withBusiness(lead, { person_name: normStr(value) });
    case "business.tagline":
      return withBusiness(lead, { tagline: normStr(value) });

    case "rubro":
      return { ...lead, rubro: parseRubro(value) };

    case "contact.phones":
      return withContact(lead, { phones: normList(value) });
    case "contact.whatsapp":
      return withContact(lead, { whatsapp: normStr(value) });
    case "contact.email":
      return withContact(lead, { email: normStr(value) });
    case "contact.address":
      return withContact(lead, { address: normStr(value) });

    case "socials.facebook":
      return withSocials(lead, { facebook: normStr(value) });
    case "socials.instagram":
      return withSocials(lead, { instagram: normStr(value) });
    case "socials.tiktok":
      return withSocials(lead, { tiktok: normStr(value) });

    case "brand.colors.primary":
      return withColors(lead, { primary: normStr(value) });
    case "brand.colors.secondary":
      return withColors(lead, { secondary: normStr(value) });
    case "brand.colors.accent":
      return withColors(lead, { accent: normStr(value) });
    case "brand.colors.background":
      return withColors(lead, { background: normStr(value) });
    case "brand.colors.surface":
      return withColors(lead, { surface: normStr(value) });
    case "brand.colors.text":
      return withColors(lead, { text: normStr(value) });

    case "content.services":
      return { ...lead, content: { ...lead.content, services: normList(value) } };

    default: {
      const _exhaustive: never = field;
      throw new Error(`campo desconocido: ${String(_exhaustive)}`);
    }
  }
}

/**
 * setAttr — funcion PURA: setea/actualiza/borra UNA credencial de
 * `business.attrs`. Las credenciales (cedula, universidad, certificacion) viven
 * en ese mapa libre `Record<string,string>`; como sus claves son dinamicas no
 * caben en el union tipado de `LeadFieldPath`, se editan por aca.
 * - `value` string       -> setea la clave (recortado).
 * - `value` null / vacio -> BORRA la clave (la credencial se quita).
 * Nunca muta el lead de entrada. No toca status ni disco.
 */
export function setAttr(lead: Lead, key: string, value: string | null): Lead {
  const attrs = { ...lead.business.attrs };
  const v = normStr(value);
  if (v === undefined) delete attrs[key];
  else attrs[key] = v;
  return { ...lead, business: { ...lead.business, attrs } };
}

/**
 * remainingNeeds — recalcula SOLO los huecos de datos reales (no los pasos de
 * proceso). Se usa al cerrar verify para limpiar de meta.needs lo que el humano
 * ya resolvio (p.ej. si ahora hay email, desaparece "falta email").
 */
function remainingNeeds(lead: Lead): string[] {
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
  if (noColors) needs.push("faltan colores de marca");

  if (lead.content.services.length === 0) needs.push("faltan servicios");
  return needs;
}

/**
 * recomputeColorsText — recalcula el mapa `colorsText` a partir de los hex de
 * `colors`. El humano edita los hex a mano en verify; el textColor es derivado,
 * asi que se re-deriva aca para que nunca quede desfasado del color (si el hex no
 * es un #rrggbb valido, ese rol se omite). Solo roles de SUPERFICIE (se pinta
 * texto encima); `text` es tinta y no lleva colorsText. Se corre al finalizar.
 */
function recomputeColorsText(colors: Lead["brand"]["colors"]): Lead["brand"]["colorsText"] {
  const out: NonNullable<Lead["brand"]["colorsText"]> = {};
  for (const role of SURFACE_ROLES) {
    const hex = colors[role];
    if (!hex) continue;
    const t = textColorFor(hex);
    if (t) out[role] = t;
  }
  return out;
}

/**
 * finalizeVerified — funcion PURA: cierra el lead tras la confirmacion humana.
 * Avanza status a "verified", RE-DERIVA colorsText de los hex (por si el humano
 * corrigio algun color) y deja en meta.needs solo los huecos que siguen abiertos
 * (limpia los pasos de proceso y lo ya resuelto). No toca disco.
 */
export function finalizeVerified(lead: Lead): Lead {
  return {
    ...lead,
    status: "verified",
    brand: { ...lead.brand, colorsText: recomputeColorsText(lead.brand.colors) },
    meta: { ...lead.meta, needs: remainingNeeds(lead) },
  };
}

// ───────────────────────────── I/O interactivo (no testeado) ─────────────────────────────

/** Descripcion de un campo para el recorrido interactivo. */
interface FieldDef {
  path: LeadFieldPath;
  label: string;
  risky: boolean;
  color?: boolean; // muestra pista de color junto al hex
}

// Campos de riesgo que son un SOLO string. Los telefonos (lista) se recorren
// aparte con promptListField, tambien marcados como riesgo.
const RISKY_FIELDS: FieldDef[] = [
  { path: "contact.whatsapp", label: "WhatsApp", risky: true },
  { path: "socials.facebook", label: "Facebook", risky: true },
  { path: "socials.instagram", label: "Instagram", risky: true },
  { path: "socials.tiktok", label: "TikTok", risky: true },
  { path: "brand.colors.primary", label: "Color primario", risky: true, color: true },
  { path: "brand.colors.secondary", label: "Color secundario", risky: true, color: true },
  { path: "brand.colors.accent", label: "Color de acento", risky: true, color: true },
  { path: "brand.colors.background", label: "Color de fondo", risky: true, color: true },
  { path: "brand.colors.surface", label: "Color de superficie", risky: true, color: true },
  { path: "brand.colors.text", label: "Color de texto (tinta)", risky: true, color: true },
];

const NAME: FieldDef = { path: "business.name", label: "Nombre del negocio", risky: false };
const PERSON: FieldDef = { path: "business.person_name", label: "Persona", risky: false };
const TAGLINE: FieldDef = { path: "business.tagline", label: "Tagline", risky: false };
const ADDRESS: FieldDef = { path: "contact.address", label: "Direccion", risky: false };
const EMAIL: FieldDef = { path: "contact.email", label: "Email", risky: false };

/** Valor actual de un campo string como texto para mostrar. */
function currentString(lead: Lead, path: LeadFieldPath): string | undefined {
  switch (path) {
    case "business.name":
      return lead.business.name;
    case "business.person_name":
      return lead.business.person_name;
    case "business.tagline":
      return lead.business.tagline;
    case "contact.whatsapp":
      return lead.contact.whatsapp;
    case "contact.email":
      return lead.contact.email;
    case "contact.address":
      return lead.contact.address;
    case "socials.facebook":
      return lead.socials.facebook;
    case "socials.instagram":
      return lead.socials.instagram;
    case "socials.tiktok":
      return lead.socials.tiktok;
    case "brand.colors.primary":
      return lead.brand.colors.primary;
    case "brand.colors.secondary":
      return lead.brand.colors.secondary;
    case "brand.colors.accent":
      return lead.brand.colors.accent;
    case "brand.colors.background":
      return lead.brand.colors.background;
    case "brand.colors.surface":
      return lead.brand.colors.surface;
    case "brand.colors.text":
      return lead.brand.colors.text;
    default:
      return undefined;
  }
}

type Rl = ReturnType<typeof createInterface>;

/** Recorre un campo string: Enter mantiene, '-' vacia, cualquier otra cosa corrige. */
async function promptStringField(rl: Rl, lead: Lead, def: FieldDef): Promise<Lead> {
  const mark = def.risky ? "  ⚠ VERIFICAR CONTRA LA TARJETA" : "";
  const cur = val(currentString(lead, def.path));
  console.log(`\n─ ${def.label}${mark}`);
  if (def.color) {
    // Los hex se MIDEN de la foto (colorthief) y el ROL lo asigna el LLM. Mostramos
    // el textColor legible que se guardara junto al hex y la paleta medida, para
    // que el humano confirme la asignacion o elija otro hex real de la lista.
    const t = cur ? textColorFor(cur) : undefined;
    console.log(`  actual: ${cur ?? "(vacio)"}${t ? `  (texto legible encima: ${t})` : ""}`);
    const pal = lead.brand.palette ?? [];
    if (pal.length) console.log(`  paleta medida (elegi uno o escribi otro hex): ${pal.join(", ")}`);
  } else {
    console.log(`  actual: ${cur ?? "(vacio)"}`);
  }
  console.log(`  [Enter]=mantener  '${CLEAR_KEY}'=vaciar  o escribi el valor corregido`);
  const ans = (await rl.question("  > ")).trim();
  if (ans === "") return lead;
  if (ans === CLEAR_KEY) return applyCorrection(lead, def.path, null);
  return applyCorrection(lead, def.path, ans);
}

/**
 * promptAttrField — recorre UNA credencial de `business.attrs`. Siempre marcada
 * de RIESGO (son datos verificables: cedulas, universidad, certificaciones; una
 * cedula mal transcrita es peor que ausente). La CLAVE es la etiqueta legible.
 * Enter mantiene, '-' borra la credencial, cualquier otra cosa la corrige.
 */
async function promptAttrField(rl: Rl, lead: Lead, key: string): Promise<Lead> {
  const cur = val(lead.business.attrs[key]);
  console.log(`\n─ ${key}  ⚠ VERIFICAR CONTRA LA TARJETA`);
  console.log(`  actual: ${cur ?? "(vacio)"}`);
  console.log(`  [Enter]=mantener  '${CLEAR_KEY}'=borrar  o escribi el valor corregido`);
  const ans = (await rl.question("  > ")).trim();
  if (ans === "") return lead;
  if (ans === CLEAR_KEY) return setAttr(lead, key, null);
  return setAttr(lead, key, ans);
}

/** Recorre rubro: valida contra el enum y re-pregunta si el valor no esta. */
async function promptRubro(rl: Rl, lead: Lead): Promise<Lead> {
  console.log(`\n─ Rubro`);
  console.log(`  actual: ${lead.rubro}`);
  console.log(`  validos: ${RUBROS.join(", ")}`);
  console.log(`  [Enter]=mantener  o escribi uno de la lista`);
  for (;;) {
    const ans = (await rl.question("  > ")).trim();
    if (ans === "") return lead;
    try {
      return applyCorrection(lead, "rubro", ans);
    } catch {
      console.log(`  ✗ "${ans}" no es un rubro valido. Elegi: ${RUBROS.join(", ")}`);
    }
  }
}

/**
 * promptListField — recorre un campo LISTA (telefonos, servicios): muestra la
 * lista actual y deja aceptar toda, vaciar, o reemplazarla entera separando por
 * comas. Es v1: no edita elemento por elemento, reemplaza la lista completa.
 */
async function promptListField(
  rl: Rl,
  lead: Lead,
  field: "contact.phones" | "content.services",
  label: string,
  markText: string,
): Promise<Lead> {
  const list = field === "contact.phones" ? lead.contact.phones ?? [] : lead.content.services;
  const mark = markText ? `  ⚠ ${markText}` : "";
  console.log(`\n─ ${label} (${list.length})${mark}`);
  if (list.length === 0) console.log("  (vacio)");
  else list.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
  console.log(`  [Enter]=aceptar toda  '${CLEAR_KEY}'=vaciar  o escribi la lista nueva separada por comas`);
  const ans = (await rl.question("  > ")).trim();
  if (ans === "") return lead;
  if (ans === CLEAR_KEY) return applyCorrection(lead, field, null);
  return applyCorrection(lead, field, ans);
}

/** Resumen final de lo que quedo, antes de pedir la confirmacion. */
function printSummary(lead: Lead): void {
  const g = (s: string | undefined) => s ?? "(vacio)";
  const c = lead.brand.colors;
  console.log("\n══ Resumen ══");
  console.log(`  Negocio:   ${g(val(lead.business.name))}`);
  console.log(`  Persona:   ${g(lead.business.person_name)}`);
  console.log(`  Tagline:   ${g(lead.business.tagline)}`);
  console.log(`  Rubro:     ${lead.rubro}`);
  const phones = lead.contact.phones ?? [];
  console.log(`  Telefonos: ${phones.length ? phones.join(", ") : "(vacio)"}`);
  console.log(`  WhatsApp:  ${g(lead.contact.whatsapp)}`);
  console.log(`  Email:     ${g(lead.contact.email)}`);
  console.log(`  Direccion: ${g(lead.contact.address)}`);
  console.log(`  Redes:     FB=${g(lead.socials.facebook)}  IG=${g(lead.socials.instagram)}  TT=${g(lead.socials.tiktok)}`);
  console.log(`  Colores:   primary=${g(c.primary)}  secondary=${g(c.secondary)}  accent=${g(c.accent)}`);
  console.log(`             background=${g(c.background)}  surface=${g(c.surface)}  text=${g(c.text)}`);
  const pal = lead.brand.palette ?? [];
  if (pal.length) console.log(`  Paleta:    ${pal.join(", ")}`);
  console.log(`  Servicios: ${lead.content.services.length ? lead.content.services.join(", ") : "(vacio)"}`);
  const attrKeys = Object.keys(lead.business.attrs);
  if (attrKeys.length) {
    console.log(`  Credenciales:`);
    for (const k of attrKeys) console.log(`    ${k}: ${lead.business.attrs[k]}`);
  }
}

/**
 * verify — etapa interactiva. Lee data.json (exige "extracted"), recorre los
 * campos con el humano, y solo si confirma valida contra LeadSchema, escribe y
 * avanza a "verified". Si cancela (n o Ctrl+C) NO escribe nada y devuelve null.
 */
export async function verify(slug: string): Promise<Lead | null> {
  if (!slug) throw new Error("verify: falta el slug. Uso: verify <slug>");

  const lead = await readLead(slug);
  if (lead.status !== "extracted") {
    throw new Error(
      `verify: el lead "${slug}" esta en status "${lead.status}", se esperaba "extracted". ` +
        `Corre 'extract ${slug}' primero.`,
    );
  }

  const rl = createInterface({ input, output });
  // Ctrl+C: como no se escribe nada hasta la confirmacion final, cortar aca deja
  // el lead intacto en "extracted".
  rl.on("SIGINT", () => {
    output.write("\n\nCancelado (Ctrl+C). No se escribio nada; el lead sigue en 'extracted'.\n");
    rl.close();
    process.exit(130);
  });

  try {
    console.log(`\nVerificando lead "${slug}" (rubro=${lead.rubro}).`);
    console.log("Primero los campos DE RIESGO (el modelo barato falla mas aca). Revisa contra la tarjeta.");

    let draft = lead;
    // telefonos: lista de riesgo (el modelo cambia digitos). Va primero.
    draft = await promptListField(rl, draft, "contact.phones", "Telefonos", "VERIFICAR CONTRA LA TARJETA");
    for (const def of RISKY_FIELDS) draft = await promptStringField(rl, draft, def);

    // credenciales (attrs): campo de riesgo. Solo se recorren las que capturo el
    // modelo (claves dinamicas). El humano confirma cada cedula/certificacion.
    const attrKeys = Object.keys(draft.business.attrs);
    if (attrKeys.length) {
      console.log("\n── Credenciales (verifica cada numero contra la tarjeta) ──");
      for (const key of attrKeys) draft = await promptAttrField(rl, draft, key);
    }

    console.log("\n── Campos generales ──");
    draft = await promptStringField(rl, draft, NAME);
    draft = await promptStringField(rl, draft, PERSON);
    draft = await promptStringField(rl, draft, TAGLINE);
    draft = await promptRubro(rl, draft);
    draft = await promptStringField(rl, draft, ADDRESS);
    draft = await promptStringField(rl, draft, EMAIL);
    // si extract() los relleno con el default del rubro (no estaban en la
    // tarjeta), meta.needs trae la marca "servicios sugeridos por rubro" y aca
    // se muestra el aviso para que el humano los confirme o los reemplace.
    const servicesSuggested = draft.meta.needs.some((n) => n.startsWith("servicios sugeridos por rubro"));
    draft = await promptListField(
      rl,
      draft,
      "content.services",
      "Servicios",
      servicesSuggested ? "SUGERIDOS POR RUBRO, NO ESTABAN EN LA TARJETA — confirma si aplican" : "",
    );

    printSummary(draft);
    const ok = (await rl.question("\n¿Confirmas? Se guarda y avanza a 'verified' (s/n): "))
      .trim()
      .toLowerCase();
    if (!["", "s", "si", "sí", "y", "yes"].includes(ok)) {
      console.log("Cancelado. No se escribio nada; el lead sigue en 'extracted'.");
      return null;
    }

    const finalized = finalizeVerified(draft);
    // Validacion estricta explicita contra el schema completo (writeLead re-valida
    // igual, pero aca damos un error claro antes de tocar disco).
    try {
      parseLead(finalized);
    } catch (err) {
      throw new Error(
        `verify: los datos no cumplen el schema estricto, no se guardo. Detalle: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    await writeLead(finalized);
    return finalized;
  } finally {
    rl.close();
  }
}

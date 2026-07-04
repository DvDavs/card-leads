import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
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

    case "content.services":
      return { ...lead, content: { ...lead.content, services: normList(value) } };

    default: {
      const _exhaustive: never = field;
      throw new Error(`campo desconocido: ${String(_exhaustive)}`);
    }
  }
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
 * finalizeVerified — funcion PURA: cierra el lead tras la confirmacion humana.
 * Avanza status a "verified" y deja en meta.needs solo los huecos que siguen
 * abiertos (limpia los pasos de proceso y lo ya resuelto). No toca disco.
 */
export function finalizeVerified(lead: Lead): Lead {
  return {
    ...lead,
    status: "verified",
    meta: { ...lead.meta, needs: remainingNeeds(lead) },
  };
}

// ───────────────────────────── I/O interactivo (no testeado) ─────────────────────────────

/**
 * describeColor — traduce un hex a un nombre de color aproximado, como PISTA
 * para el humano al verificar contra la tarjeta.
 *
 * Clasifica en HSV, no por distancia RGB: la version vieja (vecino mas cercano
 * en RGB) etiquetaba morados oscuros (#4A0A4A) y azules marino (#2C2C54) como
 * "marron", porque los colores oscuros colapsaban al unico tono calido oscuro
 * de la paleta. Un nombre que MIENTE desorienta mas que ayuda. Aca:
 * - baja saturacion => acromatico (negro / gris / blanco segun brillo);
 * - con color, el TONO (hue) decide el nombre;
 * - "marron" solo para tonos calidos (rojo/naranja) y oscuros.
 * Preferimos correcto y simple sobre exhaustivo.
 */
export function describeColor(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const v = max; // brillo (value)
  const s = max === 0 ? 0 : delta / max; // saturacion

  // Acromatico: sin tono definido. Nombre por brillo.
  if (s < 0.15 || delta < 0.04) {
    if (v < 0.2) return "negro";
    if (v > 0.85) return "blanco";
    return "gris";
  }
  if (v < 0.1) return "negro"; // muy oscuro: el tono ya no se percibe

  // Tono en grados [0, 360).
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;

  // "marron" = calido (rojo/naranja) pero oscuro y no muy saturado como neon.
  if ((h < 45 || h >= 345) && v < 0.55 && s > 0.2) return "marron";

  if (h < 15 || h >= 345) return "rojo";
  if (h < 45) return "naranja";
  if (h < 70) return "amarillo";
  if (h < 170) return "verde";
  if (h < 200) return "turquesa";
  if (h < 255) return "azul";
  if (h < 320) return "morado";
  return "rosa";
}

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
  if (def.color && cur) {
    const name = describeColor(cur);
    console.log(`  actual: ${cur}${name ? `  (≈ ${name})` : ""}`);
  } else {
    console.log(`  actual: ${cur ?? "(vacio)"}`);
  }
  console.log(`  [Enter]=mantener  '${CLEAR_KEY}'=vaciar  o escribi el valor corregido`);
  const ans = (await rl.question("  > ")).trim();
  if (ans === "") return lead;
  if (ans === CLEAR_KEY) return applyCorrection(lead, def.path, null);
  return applyCorrection(lead, def.path, ans);
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
  risky: boolean,
): Promise<Lead> {
  const list = field === "contact.phones" ? lead.contact.phones ?? [] : lead.content.services;
  const mark = risky ? "  ⚠ VERIFICAR CONTRA LA TARJETA" : "";
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
  console.log(`  Servicios: ${lead.content.services.length ? lead.content.services.join(", ") : "(vacio)"}`);
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
    draft = await promptListField(rl, draft, "contact.phones", "Telefonos", true);
    for (const def of RISKY_FIELDS) draft = await promptStringField(rl, draft, def);

    console.log("\n── Campos generales ──");
    draft = await promptStringField(rl, draft, NAME);
    draft = await promptStringField(rl, draft, PERSON);
    draft = await promptStringField(rl, draft, TAGLINE);
    draft = await promptRubro(rl, draft);
    draft = await promptStringField(rl, draft, ADDRESS);
    draft = await promptStringField(rl, draft, EMAIL);
    draft = await promptListField(rl, draft, "content.services", "Servicios", false);

    printSummary(draft);
    const ok = (await rl.question("\n¿Confirmas? Se guarda y avanza a 'verified' (s/n): "))
      .trim()
      .toLowerCase();
    if (!["s", "si", "sí", "y", "yes"].includes(ok)) {
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

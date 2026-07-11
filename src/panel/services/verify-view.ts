import { hexToRgb, textColorFor } from "../../lib/colors.js";
import { PersonGenderSchema, RubroSchema, type Lead, type Rubro, type Status } from "../../lib/schema.js";
import { RISKY_FIELDS, type FieldDef, type LeadFieldPath } from "../../stages/verify.js";

/**
 * verify-view.ts — arma el contrato UI-ready para la pantalla de verificacion
 * del panel. El celular no hace NINGUNA logica de negocio: recibe el orden
 * (riesgo primero, igual que la verify() interactiva), las opciones de los
 * enums, y para cada color de marca el hex + rgb + color de texto ya
 * calculados (reusa hexToRgb/textColorFor, no reimplementa la conversion).
 *
 * Reusa RISKY_FIELDS (exportado desde verify.ts) como UNICA fuente de verdad
 * de que campos son de riesgo y en que orden se muestran -- si el dia de
 * manana se agrega/saca un campo de riesgo en el CLI, el panel lo hereda sin
 * tocar este archivo.
 */

export interface FieldDescriptor {
  path: LeadFieldPath;
  label: string;
  risky: boolean;
  kind: "string" | "list" | "enum";
  value: string | string[] | undefined;
  options?: readonly string[];
}

export interface AttrDescriptor {
  key: string;
  value: string;
  risky: true;
}

export interface ColorField {
  role: string; // "primary" | "secondary" | "accent" | "background" | "surface" | "text"
  label: string;
  path: LeadFieldPath;
  hex: string | null;
  rgb: { r: number; g: number; b: number } | null;
  textColor: string | null;
  swatch: { background: string; color: string };
}

export interface VerifyView {
  slug: string;
  status: Status;
  rubro: Rubro;
  phones: FieldDescriptor;
  riskyFirst: FieldDescriptor[];
  colors: ColorField[];
  attrs: AttrDescriptor[];
  general: FieldDescriptor[];
  services: FieldDescriptor;
  palette: string[];
  meta: { needs: string[] };
}

/** Valor string actual de un campo escalar (no lista) del Lead. */
function stringValue(lead: Lead, path: LeadFieldPath): string | undefined {
  switch (path) {
    case "business.name":
      return lead.business.name || undefined;
    case "business.person_name":
      return lead.business.person_name;
    case "business.tagline":
      return lead.business.tagline;
    case "business.person_gender":
      return lead.business.person_gender;
    case "rubro":
      return lead.rubro;
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
    case "contact.phones":
    case "content.services":
      return undefined; // listas: ver listValue
  }
}

function fieldDescriptor(lead: Lead, def: FieldDef, kind: FieldDescriptor["kind"] = "string"): FieldDescriptor {
  const descriptor: FieldDescriptor = {
    path: def.path,
    label: def.label,
    risky: def.risky,
    kind,
    value: stringValue(lead, def.path),
  };
  if (def.path === "rubro") descriptor.options = RubroSchema.options;
  if (def.path === "business.person_gender") descriptor.options = PersonGenderSchema.options;
  return descriptor;
}

function colorField(lead: Lead, def: FieldDef): ColorField {
  const role = def.path.replace("brand.colors.", "");
  const hex = stringValue(lead, def.path) ?? null;
  const rgb = hex ? hexToRgb(hex) : null;
  const textColor = hex ? (textColorFor(hex) ?? null) : null;
  return {
    role,
    label: def.label,
    path: def.path,
    hex,
    rgb,
    textColor,
    // swatch listo para spread en style: fondo = el hex, texto = el que se lee encima.
    swatch: { background: hex ?? "transparent", color: textColor ?? "inherit" },
  };
}

const NAME: FieldDef = { path: "business.name", label: "Nombre del negocio", risky: false };
const PERSON: FieldDef = { path: "business.person_name", label: "Persona", risky: false };
const GENDER: FieldDef = { path: "business.person_gender", label: "Genero de la persona", risky: false };
const TAGLINE: FieldDef = { path: "business.tagline", label: "Tagline", risky: false };
const RUBRO: FieldDef = { path: "rubro", label: "Rubro", risky: false };
const ADDRESS: FieldDef = { path: "contact.address", label: "Direccion", risky: false };
const EMAIL: FieldDef = { path: "contact.email", label: "Email", risky: false };

export function buildVerifyView(lead: Lead): VerifyView {
  const riskyStringFields = RISKY_FIELDS.filter((f) => !f.color);
  const colorFields = RISKY_FIELDS.filter((f) => f.color);

  return {
    slug: lead.slug,
    status: lead.status,
    rubro: lead.rubro,
    phones: {
      path: "contact.phones",
      label: "Telefonos",
      risky: true,
      kind: "list",
      value: lead.contact.phones ?? [],
    },
    riskyFirst: riskyStringFields.map((def) => fieldDescriptor(lead, def)),
    colors: colorFields.map((def) => colorField(lead, def)),
    attrs: Object.entries(lead.business.attrs).map(([key, value]) => ({ key, value, risky: true as const })),
    general: [NAME, PERSON, GENDER, TAGLINE, RUBRO, ADDRESS, EMAIL].map((def) =>
      fieldDescriptor(lead, def, def.path === "rubro" || def.path === "business.person_gender" ? "enum" : "string"),
    ),
    services: {
      path: "content.services",
      label: "Servicios",
      risky: false,
      kind: "list",
      value: lead.content.services,
    },
    palette: lead.brand.palette ?? [],
    meta: { needs: lead.meta.needs },
  };
}

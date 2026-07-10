import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StatusSchema, type Lead, type Rubro, type Status } from "../lib/schema.js";
import { renderTemplate } from "../lib/template.js";
import { readLead, writeArtifact, writeLead } from "../lib/storage.js";
import {
  FALLBACK_THEME,
  WHATSAPP_PREFILL,
  buildMapsUrl,
  deriveWhatsappNumber,
  socialUrl,
} from "./build-cards.js";

/**
 * build-web — genera UNA pagina web por lead, rellenando una plantilla HTML por
 * rubro con los datos REALES del lead + el copy de marketing que ya produjo
 * `enrich` (`content.generated_copy`, se LEE de disco, NO se regenera). Escribe
 * `leads/<slug>/web/index.html` y guarda la ruta en `generated.web_url`.
 *
 * Hoy solo esta implementado el rubro `doctor` con una plantilla
 * (`dr_arefin`). El diseno queda listo para sumar mas plantillas/rubros:
 * agregar una entrada en WEB_TEMPLATE_FILE + su .html parametrizado.
 *
 * A diferencia de las digital cards (build-cards), la web NO necesita ser
 * self-contained: vive en internet y luego migra al server del cliente. Tailwind
 * CDN, iconify y Google Fonts estan permitidos. La UNICA restriccion de recursos
 * externos es cero fotos de personas que no sean del negocio real.
 */

const WEB_DIR = "web";
const WEB_FILE = "index.html";

/**
 * Anotacion de `meta.needs` que marca el horario como SUGERIDO por rubro (no
 * confirmado por el humano). `enrich` la escribe cuando rellena `contact.hours`
 * con el default del rubro. Si esta presente, la web muestra el horario con una
 * marca visual discreta ("Referencial"); si el humano lo confirmo en verify, la
 * anotacion desaparece y el horario se muestra sin marca.
 */
const HOURS_NEEDS_PREFIX = "horario sugerido por rubro";

/**
 * Clave de `generated_copy.sample_fields` que marca los testimonios como
 * EJEMPLO (no reales). Cuando esta, la seccion de reseñas lleva un aviso
 * visualmente ligado a los testimonios (no solo el disclaimer del pie): es lo
 * que el cliente mas nota como "no mio".
 */
const SAMPLE_TESTIMONIALS_KEY = "testimonials";

/**
 * Plantilla web por rubro (relativa a `src/templates/`). Solo `doctor` esta
 * implementado; el resto lanza un error claro hasta que tenga su .html. El
 * mapeo rubro -> carpeta ya vive en `rubroConfig(rubro).webTemplate`; aca se fija
 * el ARCHIVO concreto dentro de esa carpeta.
 */
const WEB_TEMPLATE_FILE: Partial<Record<Rubro, string>> = {
  doctor: "doctor/dr_arefin.html",
};

const WEB_TEMPLATES_DIR = new URL("../templates/", import.meta.url);

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

/**
 * hoursAreReferential — PURA: true si el horario del lead viene del default por
 * rubro (sin confirmar por el humano). Se detecta por la anotacion de
 * `meta.needs` que escribe `enrich`. La web lo usa para marcar el horario como
 * "Referencial".
 */
export function hoursAreReferential(lead: Lead): boolean {
  return lead.meta.needs.some((n) => n.trim().toLowerCase().startsWith(HOURS_NEEDS_PREFIX));
}

/**
 * webAssetSrc — PURA: normaliza una ruta de imagen del lead (logo/foto) para
 * usarla dentro de `leads/<slug>/web/index.html`. La web vive un nivel bajo la
 * carpeta del lead, asi que una ruta relativa al lead necesita subir uno
 * (`../`). Las data URI y URLs absolutas se dejan intactas. Cadena vacia si no
 * hay ruta.
 */
export function webAssetSrc(p: string | undefined): string {
  if (!p) return "";
  if (/^(data:|https?:\/\/)/i.test(p)) return p;
  return "../" + p.replace(/^\.?\//, "");
}

/* ------------------------------------------------------------------ */
/* Guard de status                                                     */
/* ------------------------------------------------------------------ */

/**
 * La web se construye SOLO desde un lead con el copy ya generado: status
 * "enriched" o posterior. Mismo criterio que `assertBuildableStatus` de
 * build-cards: orden por indice en StatusSchema.options, "error" excluido
 * explicito (queda despues en el enum pero no es camino feliz).
 */
export function assertWebBuildableStatus(status: Status): void {
  const order = StatusSchema.options;
  const ok = status !== "error" && order.indexOf(status) >= order.indexOf("enriched");
  if (ok) return;

  const hint =
    order.indexOf(status) < order.indexOf("verified")
      ? "Ejecuta primero `extract`, `verify` y `enrich`."
      : "Ejecuta primero `enrich` (genera el copy de marketing de la web).";
  throw new Error(
    `build-web: el lead esta en status "${status}" y se requiere "enriched" o posterior. ${hint}`,
  );
}

/* ------------------------------------------------------------------ */
/* Vista pura                                                          */
/* ------------------------------------------------------------------ */

/**
 * buildWebView — funcion PURA: Lead (+ anio) -> objeto de template para la web.
 * Mismo contrato que `buildCardView`: un dato ausente en el lead NUNCA aparece
 * vacio ni como "undefined"; su seccion `{{#hasX}}` simplemente no renderiza.
 * Reusa los helpers ya probados de build-cards (WhatsApp derivado, maps, redes)
 * para no duplicar logica. `year` es parametro para que los tests fijen la
 * salida.
 *
 * Todo lo INTERPRETATIVO (colores medidos, copy generado por enrich) ya viene
 * del lead; aca solo se derivan datos deterministas para el HTML. El copy vive
 * en `content.generated_copy` (SEPARADO de los datos reales) y se lee tal cual,
 * sin regenerar.
 */
export function buildWebView(
  lead: Lead,
  year: number = new Date().getFullYear(),
): Record<string, unknown> {
  const b = lead.business;
  const c = lead.contact;
  const s = lead.socials;
  const gc = lead.content.generated_copy;

  /* ---------- identidad + imagen (cascada, cero caras falsas) ---------- */
  // Nombre: persona -> negocio -> slug. El negocio puede no tener `name` (cuelga
  // todo de la persona); nunca se muestra un nombre vacio.
  const heroName = b.person_name || b.name || lead.slug;
  const tagline = b.tagline ?? "";
  const hasTagline = Boolean(tagline);

  const initialSource = b.person_name?.trim() || b.name.trim() || lead.slug;
  const initial = initialSource.charAt(0).toUpperCase();

  // Imagen del hero: foto real -> logo real -> placeholder de iniciales sobre
  // gradiente de marca. NUNCA una foto stock/generada. `has_logo` (booleano) NO
  // basta: puede ser true sin que exista la ruta en disco, asi que se decide por
  // la RUTA (photo_path/logo_path), no por el flag.
  const imageSrc = webAssetSrc(lead.brand.photo_path ?? lead.brand.logo_path);
  const hasImage = imageSrc !== "";

  /* ---------- contacto (datos reales, nunca del LLM) ---------- */
  const phones = c.phones ?? [];
  const primaryPhone = phones[0];
  const hasPhone = Boolean(primaryPhone);
  const phoneDisplay = primaryPhone ?? "";
  const phoneTelHref = primaryPhone ? `tel:${primaryPhone.replace(/[^\d+]/g, "")}` : "";

  const waNumber = deriveWhatsappNumber(c);
  const whatsappUrl = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(WHATSAPP_PREFILL)}`
    : "";
  const hasWhatsapp = whatsappUrl !== "";

  const addressText = (c.address ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ");
  const hasAddress = addressText !== "";
  const mapsUrl = c.address ? buildMapsUrl(c.address) : "";

  const hasEmail = Boolean(c.email);
  const email = c.email ?? "";

  const hasInstagram = Boolean(s.instagram);
  const instagramUrl = s.instagram ? socialUrl("instagram", s.instagram) : "";
  const hasFacebook = Boolean(s.facebook);
  const facebookUrl = s.facebook ? socialUrl("facebook", s.facebook) : "";
  const hasTiktok = Boolean(s.tiktok);
  const tiktokUrl = s.tiktok ? socialUrl("tiktok", s.tiktok) : "";
  const hasSocials = hasInstagram || hasFacebook || hasTiktok;

  // Horario: `contact.hours` es un string ("Lun a Vie 9-18, Sab 9-14"); se parte
  // por coma en lineas. Puede ser un default por rubro (no confirmado) => flag
  // referencial para marcarlo visualmente.
  const hoursLines = (c.hours ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  const hasHours = hoursLines.length > 0;
  const hoursReferential = hoursAreReferential(lead);

  /* ---------- credenciales (business.attrs, tal cual) ---------- */
  // Pares clave/valor legibles ("Universidad", "Cedula profesional", ...). Se
  // renderizan tal cual estan; limpiar el formato es tarea del humano en verify,
  // no de esta etapa.
  const attrs = Object.entries(b.attrs).map(([key, value]) => ({ key, value }));
  const hasAttrs = attrs.length > 0;

  /* ---------- servicios REALES + su descripcion generada ---------- */
  // La lista de servicios manda (autoridad = verify). Cada descripcion se casa
  // por nombre; los servicios sin descripcion se muestran igual (solo el nombre).
  const descByName = new Map(
    (gc?.service_descriptions ?? []).map((d) => [d.name, d.description] as const),
  );
  const services = lead.content.services.map((name, i) => ({
    n: String(i + 1).padStart(2, "0"),
    name,
    description: descByName.get(name) ?? "",
    hasDescription: descByName.has(name),
  }));
  const hasServices = services.length > 0;

  /* ---------- copy de marketing (generated_copy) ---------- */
  const heroBadge = gc?.hero_badge ?? "";
  const hasHeroBadge = Boolean(gc?.hero_badge);
  // Hero siempre muestra algo aunque falte el copy (fallback a tagline/nombre).
  const heroHeadline = gc?.hero_headline || tagline || heroName;
  const heroSubheadline = gc?.hero_subheadline ?? "";
  const hasHeroSubheadline = Boolean(gc?.hero_subheadline);

  const bio = gc?.bio ?? "";
  const hasBio = Boolean(gc?.bio);
  const pullQuote = gc?.pull_quote ?? "";
  const hasPullQuote = Boolean(gc?.pull_quote);
  const hasAbout = hasBio || hasPullQuote || hasAttrs;

  const valueProps = gc?.value_props ?? [];
  const hasValueProps = valueProps.length > 0;

  const faqs = gc?.faqs ?? [];
  const hasFaqs = faqs.length > 0;

  const testimonials = gc?.testimonials ?? [];
  const hasTestimonials = testimonials.length > 0;
  // Aviso "de ejemplo" ligado a la seccion de reseñas (no solo al pie).
  const testimonialsAreSample = Boolean(gc?.sample_fields?.includes(SAMPLE_TESTIMONIALS_KEY));

  const ctaHeadline = gc?.cta_headline || "Contactanos";
  const ctaSubtext = gc?.cta_subtext ?? "";
  const hasCtaSubtext = Boolean(gc?.cta_subtext);

  const footerTagline = gc?.footer_tagline || tagline;
  const hasFooterTagline = Boolean(footerTagline);

  /* ---------- tema (colores de marca como CSS vars) ---------- */
  // primary/secondary/accent: siempre presentes (par color+texto legible WCAG,
  // ya calculado en verify — aca NO se recalcula). Si falta un rol, se usa el par
  // de reserva completo, para no mezclar el texto de un color con el fondo de otro.
  const roles = ["primary", "secondary", "accent"] as const;
  const colors: Record<string, string> = {};
  const colorsText: Record<string, string> = {};
  for (const role of roles) {
    const measured = lead.brand.colors[role];
    colors[role] = measured ?? FALLBACK_THEME[role].color;
    colorsText[role] = measured
      ? (lead.brand.colorsText?.[role] ?? FALLBACK_THEME[role].text)
      : FALLBACK_THEME[role].text;
  }

  /* ---------- meta ---------- */
  const pageTitle = gc?.meta_title || (tagline ? `${heroName} — ${tagline}` : heroName);
  const metaDescription =
    gc?.meta_description || tagline || bio || `Informacion y contacto de ${heroName}`;

  return {
    // identidad + imagen
    slug: lead.slug,
    heroName,
    tagline,
    hasTagline,
    hasImage,
    imageSrc,
    initial,

    // copy
    heroBadge,
    hasHeroBadge,
    heroHeadline,
    heroSubheadline,
    hasHeroSubheadline,
    bio,
    hasBio,
    pullQuote,
    hasPullQuote,
    hasAbout,
    valueProps,
    hasValueProps,
    faqs,
    hasFaqs,
    testimonials,
    hasTestimonials,
    testimonialsAreSample,
    ctaHeadline,
    ctaSubtext,
    hasCtaSubtext,
    footerTagline,
    hasFooterTagline,

    // servicios + credenciales
    services,
    hasServices,
    attrs,
    hasAttrs,

    // contacto
    hasPhone,
    phoneDisplay,
    phoneTelHref,
    whatsappUrl,
    hasWhatsapp,
    addressText,
    hasAddress,
    mapsUrl,
    hasEmail,
    email,
    hoursLines,
    hasHours,
    hoursReferential,
    hasInstagram,
    instagramUrl,
    hasFacebook,
    facebookUrl,
    hasTiktok,
    tiktokUrl,
    hasSocials,

    // tema + meta
    colors,
    colorsText,
    year,
    pageTitle,
    metaDescription,
  };
}

/* ------------------------------------------------------------------ */
/* Carga de plantilla + escritura                                      */
/* ------------------------------------------------------------------ */

async function loadWebTemplate(rubro: Rubro): Promise<string> {
  const rel = WEB_TEMPLATE_FILE[rubro];
  if (!rel) {
    throw new Error(
      `build-web: el rubro "${rubro}" aun no tiene plantilla web (por ahora solo "doctor").`,
    );
  }
  return fs.readFile(fileURLToPath(new URL(rel, WEB_TEMPLATES_DIR)), "utf8");
}

/**
 * build-web — etapa CLI. Exige status "enriched" o posterior (guard ANTES de
 * tocar disco). Rellena la plantilla del rubro con `buildWebView` y escribe
 * `leads/<slug>/web/index.html`. Avanza el status a "web_built" solo si el lead
 * no estaba ya mas adelante (regenerar el artefacto no retrocede el pipeline).
 * Devuelve la ruta absoluta escrita.
 */
export async function buildWeb(slug: string): Promise<string> {
  if (!slug) throw new Error("build-web: falta el slug. Uso: build-web <slug>");

  const lead = await readLead(slug);
  assertWebBuildableStatus(lead.status);

  const template = await loadWebTemplate(lead.rubro);
  const view = buildWebView(lead);
  const html = renderTemplate(template, view);

  const relPath = path.posix.join(WEB_DIR, WEB_FILE);
  const outPath = await writeArtifact(slug, relPath, html);

  const order = StatusSchema.options;
  const status: Status =
    order.indexOf(lead.status) < order.indexOf("web_built") ? "web_built" : lead.status;

  await writeLead({
    ...lead,
    status,
    generated: { ...lead.generated, web_url: relPath },
  });

  return outPath;
}

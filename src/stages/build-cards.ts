import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARD_LABELS, RUBRO_TEMPLATE_ORDER } from "../config/rubro-map.js";
import { textColorFor } from "../lib/colors.js";
import { StatusSchema, type Lead, type Rubro, type Status } from "../lib/schema.js";
import { renderTemplate } from "../lib/template.js";
import { copyTreeIntoLead, readLead, writeArtifact, writeLead } from "../lib/storage.js";

/**
 * build-cards — reemplaza a build-linktree. En vez de un solo diseno, rellena
 * TODOS los templates que encuentre en `src/dc-templates/` (el "pool") con los
 * datos del lead y arma un visor swipeable que los junta. Cada diseno queda
 * como archivo standalone en `leads/<slug>/dc/<template>.html`, mas
 * `leads/<slug>/dc/index.html` (el visor).
 *
 * Agregar un diseno nuevo = tirar un .html mas en `src/dc-templates/` (que no
 * empiece con "_"): este stage lo detecta solo, no hay que tocar codigo.
 */

const DC_DIR = "dc";
const VIEWER_FILE = "index.html";
/**
 * ASSETS_DIR — subcarpeta de recursos compartidos del pool (imagenes de los
 * disenos guelaguetza-*). Vive en `src/dc-templates/assets/` y se espeja en
 * `leads/<slug>/dc/assets/` para que las rutas relativas (`assets/...`) de esos
 * disenos resuelvan dentro del iframe del visor. Son recursos EXCLUSIVOS de los
 * disenos guelaguetza; el resto del pool no los referencia.
 */
const ASSETS_DIR = "assets";

/**
 * GENERATED_WEB_REL_URL — ruta RELATIVA de una digital card (`dc/<archivo>`)
 * hacia la mini-web que le genera `build-web` (`web/index.html`), carpeta
 * HERMANA dentro del mismo `leads/<slug>/`. Relativa (no absoluta) a proposito:
 * funciona igual al previsualizar el HTML local (`leads/<slug>/dc/x.html`)
 * y una vez publicado (`deploy` sube `dc/` y `web/` conservando la misma
 * estructura de carpetas, ver `publicUrl` en `src/stages/deploy.ts`).
 */
const GENERATED_WEB_REL_URL = "../web/";

/* ------------------------------------------------------------------ */
/* Constantes tuneables (mismo criterio que los umbrales de colors.ts) */
/* ------------------------------------------------------------------ */

/**
 * FONT_FAMILIES — mapa font_hint -> familia tipografica real, usado por el
 * diseno "credencial" (self-contained, sin fonts remotas). Los otros disenos
 * del pool traen su propia tipografia via Google Fonts en su propio <head>.
 */
export const FONT_FAMILIES: Record<string, string> = {
  serif: 'Georgia, "Times New Roman", Times, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  display: '"Trebuchet MS", "Segoe UI", Verdana, system-ui, sans-serif',
};

/** Hint por defecto cuando font_hint falta o no esta en FONT_FAMILIES. */
export const DEFAULT_FONT_HINT = "sans";

/**
 * DEFAULT_COUNTRY_CODE — codigo de pais que se antepone a un telefono local
 * para armar el enlace de WhatsApp (wa.me exige numero internacional).
 * SUPUESTO DOCUMENTADO: los leads son negocios de Mexico (52) y un numero
 * local mexicano tiene 10 digitos. Si el numero ya trae mas de
 * LOCAL_NUMBER_MAX_DIGITS digitos se asume que ya incluye codigo de pais y
 * no se toca. Ajustar ambas constantes si el negocio cambia de pais.
 */
export const DEFAULT_COUNTRY_CODE = "52";
export const LOCAL_NUMBER_MAX_DIGITS = 10;

/**
 * Mensaje precargado del boton de WhatsApp: el cliente abre el chat con el
 * texto ya escrito y solo toca "enviar". Baja la friccion del primer contacto.
 */
export const WHATSAPP_PREFILL = "Hola, vi su tarjeta y me gustaria mas informacion.";

/**
 * Colores de reserva cuando la medicion de marca fallo o falta un rol.
 * Van en PARES color+texto (el texto es legible sobre SU color de reserva);
 * nunca se recalcula WCAG aca — eso ya lo hace verify sobre los colores reales.
 */
export const FALLBACK_THEME: Record<"primary" | "secondary" | "accent", { color: string; text: string }> = {
  primary: { color: "#111827", text: "#ffffff" },
  secondary: { color: "#374151", text: "#ffffff" },
  accent: { color: "#2563eb", text: "#ffffff" },
};

/**
 * Tipo schema.org por rubro para el JSON-LD embebido. Cuando la card se
 * publique, buscadores y previews (Google, WhatsApp) leen esta ficha.
 */
export const JSONLD_TYPE: Record<Rubro, string> = {
  doctor: "Physician",
  barberia: "HairSalon",
  estetica: "BeautySalon",
  veterinario: "VeterinaryCare",
  nutriologo: "MedicalBusiness",
  otro: "LocalBusiness",
};

/* ------------------------------------------------------------------ */
/* Iconos SVG inline (self-contained, sin fetch externo)               */
/* ------------------------------------------------------------------ */

const ICON_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

/**
 * LINK_ICONS — un icono por `kind` de enlace (usado por el diseno
 * "credencial"; los otros disenos traen sus propios SVG inline en el propio
 * template). Se inyectan como HTML crudo ({{{icon}}}) porque son markup.
 */
export const LINK_ICONS: Record<string, string> = {
  whatsapp: `<svg ${ICON_ATTRS}><path d="M12 3a9 9 0 0 0-7.8 13.4L3.2 21l4.7-1A9 9 0 1 0 12 3z"/><g transform="translate(7 7) scale(0.42)"><path stroke-width="4.2" d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z"/></g></svg>`,
  phone: `<svg ${ICON_ATTRS}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z"/></svg>`,
  email: `<svg ${ICON_ATTRS}><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/></svg>`,
  website: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.9 5.7 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z"/></svg>`,
  instagram: `<svg ${ICON_ATTRS}><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none"/></svg>`,
  facebook: `<svg ${ICON_ATTRS}><path fill="currentColor" stroke="none" d="M14.5 8.3h3.2V5h-3.2C12 5 10 7 10 9.5V12H7v3.4h3V21h3.4v-5.6h2.8l.6-3.4h-3.4V9.5c0-.7.5-1.2 1.1-1.2z"/></svg>`,
  tiktok: `<svg ${ICON_ATTRS}><path fill="currentColor" stroke="none" d="M16.6 3c.4 2.3 1.9 3.7 4.2 3.9V10c-1.6 0-3-.5-4.2-1.3v6.4a5.9 5.9 0 1 1-5.9-5.9c.3 0 .6 0 .9.1v3.2a2.8 2.8 0 1 0 1.9 2.6V3h3.1z"/></svg>`,
  maps: `<svg ${ICON_ATTRS}><path d="M20 10.5c0 5.7-8 11-8 11s-8-5.3-8-11a8 8 0 0 1 16 0z"/><circle cx="12" cy="10.5" r="3"/></svg>`,
};

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

export interface CardLink {
  label: string;
  url: string;
  kind: string;
  icon: string;
  /** true => CTA destacado (fondo accent). */
  primary?: boolean;
  /** true => target="_blank" + rel (solo enlaces que salen de la pagina). */
  external?: boolean;
}

/** Solo digitos: WhatsApp necesita el numero pelado para wa.me. */
function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Numero de WhatsApp en formato internacional (solo digitos).
 * DECISION: si no hay `contact.whatsapp` explicito se deriva de `phones[0]`
 * (supuesto: el numero principal del negocio tiene WhatsApp — en este mercado
 * es lo normal, y el boton es el CTA que mas convierte).
 */
export function deriveWhatsappNumber(contact: Lead["contact"]): string | undefined {
  const source = contact.whatsapp ?? contact.phones?.[0];
  if (!source) return undefined;
  let num = digits(source);
  if (!num) return undefined;
  if (num.length <= LOCAL_NUMBER_MAX_DIGITS) num = DEFAULT_COUNTRY_CODE + num;
  return num;
}

/** Resuelve font_hint (pista laxa, case-insensitive) a un stack web-safe. */
export function resolveFontFamily(fontHint: string | undefined): string {
  const key = fontHint?.trim().toLowerCase() ?? "";
  return FONT_FAMILIES[key] ?? FONT_FAMILIES[DEFAULT_FONT_HINT]!;
}

/** URL de Google Maps para una direccion con saltos de linea. */
export function buildMapsUrl(address: string): string {
  const query = address
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Normaliza un valor de red social a URL: si ya es http(s) se respeta; si es
 * un handle ("@drkarey" o "drkarey") se arma la URL canonica de la red.
 * verify guarda lo que el humano confirmo, que muchas veces es solo el handle.
 */
export function socialUrl(kind: "instagram" | "facebook" | "tiktok", value: string): string {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  switch (kind) {
    case "instagram":
      return `https://www.instagram.com/${handle}`;
    case "facebook":
      return `https://www.facebook.com/${handle}`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
  }
}

/**
 * buildJsonLd — ficha schema.org (JSON-LD) por rubro. Se embebe en un
 * <script type="application/ld+json"> para que, al publicarse, Google y las
 * previews de mensajeria entiendan que es un negocio local con telefono y
 * direccion. `<` se escapa como < para que ningun dato pueda cerrar el
 * tag <script> (inyeccion clasica en JSON embebido).
 */
export function buildJsonLd(lead: Lead): string {
  const { business, contact, socials } = lead;
  const sameAs = [
    socials.instagram && socialUrl("instagram", socials.instagram),
    socials.facebook && socialUrl("facebook", socials.facebook),
    socials.tiktok && socialUrl("tiktok", socials.tiktok),
  ].filter(Boolean);

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": JSONLD_TYPE[lead.rubro],
    name: business.name || lead.slug,
  };
  if (business.tagline) data.description = business.tagline;
  const phone = contact.phones?.[0];
  if (phone) data.telephone = phone;
  if (contact.email) data.email = contact.email;
  if (contact.website) data.url = contact.website;
  if (contact.address) {
    data.address = {
      "@type": "PostalAddress",
      streetAddress: contact.address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(", "),
    };
  }
  if (sameAs.length) data.sameAs = sameAs;

  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/* ------------------------------------------------------------------ */
/* Capa de motivos (fondo decorativo intercambiable por rubro)         */
/* ------------------------------------------------------------------ */

/**
 * Cada diseno nuevo del pool trae un bloque de motivos decorativos entre los
 * marcadores `<!-- MOTIF:START (rubro=X) -->` y `<!-- MOTIF:END -->`, al inicio
 * del <body>. `_motifs.html` es la LIBRERIA: un bloque por rubro (mismo wrapper
 * `.motif` y sprites `.m1`-`.m5`; solo cambia el arte SVG). `build-cards`
 * reemplaza el bloque que trae cada template por el del rubro del lead, asi
 * TODOS los disenos que ve el cliente muestran motivos coherentes con su rubro.
 * El color y la posicion los pone el CSS de cada diseno (currentColor -> paleta
 * de marca); los bloques no llevan variables de template.
 *
 * Los disenos viejos (credencial/clinic/dark/executive/luxury) no traen
 * marcadores: `swapMotif` los deja intactos (no-op).
 */
const MOTIF_BLOCK_RE = /<!--\s*MOTIF:START[\s\S]*?MOTIF:END\s*-->/;
const MOTIF_PARSE_RE = /<!--\s*MOTIF:START\s*\(rubro=([a-z]+)\)\s*-->[\s\S]*?<!--\s*MOTIF:END\s*-->/gi;

/**
 * parseMotifs — PURA: extrae de `_motifs.html` (o cualquier HTML con los
 * marcadores) un mapa rubro -> bloque completo (marcadores incluidos, listo
 * para pegar). La clave es el `rubro=` del marcador.
 */
export function parseMotifs(motifsHtml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of motifsHtml.matchAll(MOTIF_PARSE_RE)) {
    out[m[1]!.toLowerCase()] = m[0];
  }
  return out;
}

/**
 * swapMotif — PURA: reemplaza el bloque de motivos del template por
 * `motifBlock`. Si el template no trae marcadores (disenos viejos) o
 * `motifBlock` es undefined (no hay bloque para ese rubro), devuelve el
 * template sin tocar.
 */
export function swapMotif(templateHtml: string, motifBlock: string | undefined): string {
  if (!motifBlock || !MOTIF_BLOCK_RE.test(templateHtml)) return templateHtml;
  // Replacer como FUNCION (no string): el bloque es SVG crudo y String.replace
  // interpretaria patrones "$" en un string de reemplazo. Asi entra literal.
  return templateHtml.replace(MOTIF_BLOCK_RE, () => motifBlock);
}

/**
 * BRAND_TOGGLE_SNIPPET — listener del toggle "Ver con los colores de tu
 * marca" (_viewer.html). Identico en las 14 cards y sin datos del lead, asi
 * que se inyecta en build time en vez de repetirlo a mano en cada template
 * (misma regla que el resto del pool: agregar diseno = tirar un .html, sin
 * tocar codigo). Cada card declara su paleta ORIGINAL en `:root` y su paleta
 * de MARCA en `:root[data-brand]`; este script solo prende/apaga ese
 * atributo segun lo que le mande el visor por postMessage, y avisa al cargar
 * (`dc-brand-ready`) para que el visor le reenvie el estado actual — cubre
 * los iframes que cargan lazy al hacer swipe.
 */
const BRAND_TOGGLE_SNIPPET = `<script>(function(){
  function apply(on){document.documentElement.toggleAttribute('data-brand',!!on);}
  addEventListener('message',function(e){var d=e.data;if(d&&d.type==='dc-brand')apply(!!d.on);});
  try{parent.postMessage({type:'dc-brand-ready'},'*');}catch(_){}
})();</script>`;

/**
 * injectBrandToggle — PURA: inserta `BRAND_TOGGLE_SNIPPET` justo antes de
 * `</body>`. Fallback a append si el template no trae `</body>` (no deberia
 * pasar, todas las cards del pool son HTML completo), para no perder el
 * listener en silencio.
 */
export function injectBrandToggle(html: string): string {
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${BRAND_TOGGLE_SNIPPET}</body>`)
    : html + BRAND_TOGGLE_SNIPPET;
}

/* ------------------------------------------------------------------ */
/* Guard de status                                                     */
/* ------------------------------------------------------------------ */

/**
 * Las digital cards se construyen SOLO desde datos confirmados por el humano:
 * status "verified" o posterior en la secuencia del pipeline. El orden se
 * calcula por indice en StatusSchema.options (no hay lista duplicada), y
 * "error" se excluye explicito porque en el enum queda DESPUES de "verified"
 * pero no es un estado del camino feliz.
 */
export function assertBuildableStatus(status: Status): void {
  const order = StatusSchema.options;
  const isBuildable = status !== "error" && order.indexOf(status) >= order.indexOf("verified");
  if (isBuildable) return;

  const hint =
    status === "ingested"
      ? "Ejecuta primero `extract` y luego `verify`."
      : status === "extracted"
        ? "Ejecuta primero `verify` (checkpoint humano)."
        : "Revisa `meta.errors` del lead.";
  throw new Error(
    `build-cards: el lead esta en status "${status}" y se requiere "verified" o posterior. ${hint}`,
  );
}

/**
 * hasGeneratedWebsite — true si el lead YA tiene su mini-web propia generada
 * por la etapa `build-web` (status "web_built" o posterior, "error" excluido).
 *
 * DECISION: `build-cards` corre ANTES que `build-web` en el pipeline feliz
 * (ver `src/cli.ts`), asi que no se puede chequear en disco si `web/` existe
 * al momento de armar la digital card. La URL hacia `web/` es deterministica
 * (carpeta hermana de `dc/`, ver `generatedWebUrl` en `buildCardView`), pero
 * mostrar el link SIEMPRE llevaria a un 404 si el cliente lo toca antes de
 * que `build-web` corra. Por eso se gatea con el status real del lead (mismo
 * criterio de `assertBuildableStatus`/`assertDeployableStatus`): `build-cards`
 * puede volver a correrse mas adelante para regenerar las cards de un lead
 * que YA paso por `build-web` (status "web_built" o posterior) — en ese caso
 * si corresponde mostrar el link.
 */
export function hasGeneratedWebsite(status: Status): boolean {
  const order = StatusSchema.options;
  return status !== "error" && order.indexOf(status) >= order.indexOf("web_built");
}

/* ------------------------------------------------------------------ */
/* Vista pura + render                                                 */
/* ------------------------------------------------------------------ */

/**
 * buildCardView — funcion PURA: Lead (+ anio) -> objeto de template, valido
 * para CUALQUIER diseno del pool. Todo lo interpretable (colores medidos,
 * textos confirmados) ya viene del lead; aca solo se derivan datos
 * deterministas para el HTML. Un campo ausente en el lead nunca aparece como
 * "undefined" ni vacio en la card: su seccion `{{#hasX}}` correspondiente
 * simplemente no renderiza. `year` es parametro para que los tests fijen la
 * salida (el default usa el reloj).
 *
 * Este objeto es un SUPERSET: incluye tanto las claves del diseno original
 * "credencial" (name/personName/links/address/... — mismo contrato de antes,
 * ver tests) como las claves planas que consumen los disenos nuevos
 * (heroName/hasPhone/whatsappUrl/attrs/...).
 */
export function buildCardView(
  lead: Lead,
  year: number = new Date().getFullYear(),
): Record<string, unknown> {
  const c = lead.contact;
  const s = lead.socials;

  /* ---------- identidad ---------- */
  const name = lead.business.name || lead.slug; // fallback al slug (credencial: h1)
  const personName = lead.business.person_name ?? ""; // credencial: subtitulo
  const tagline = lead.business.tagline ?? "";

  // heroName/orgName: para los disenos "persona primero" (clinic/dark/
  // executive/luxury) donde el h1 es la persona. Nunca queda vacio (cae a
  // business.name y despues al slug); la linea de organizacion solo se
  // muestra si aporta algo distinto de lo que ya esta en el h1.
  const heroName = lead.business.person_name || lead.business.name || lead.slug;
  const orgName = lead.business.name;
  const hasOrgLine = Boolean(orgName) && orgName !== heroName;

  // Inicial para el avatar placeholder del diseno credencial (nunca una cara
  // generada): negocio -> persona -> slug.
  const initialSource = lead.business.name.trim() || lead.business.person_name?.trim() || lead.slug;
  const initial = initialSource.charAt(0).toUpperCase();

  /* ---------- links (diseno credencial: lista generica) ---------- */
  const links: CardLink[] = [];

  const waNumber = deriveWhatsappNumber(c);
  const waUrl = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(WHATSAPP_PREFILL)}`
    : undefined;
  if (waUrl) {
    links.push({ label: "WhatsApp", url: waUrl, kind: "whatsapp", icon: LINK_ICONS.whatsapp!, primary: true, external: true });
  }

  const phones = c.phones ?? [];
  phones.forEach((p, i) => {
    const tel = p.replace(/[^\d+]/g, "");
    if (!tel) return;
    links.push({
      label: phones.length > 1 ? `Llamar ${i + 1}` : "Llamar",
      url: `tel:${tel}`,
      kind: "phone",
      icon: LINK_ICONS.phone!,
    });
  });

  if (c.email) links.push({ label: "Email", url: `mailto:${c.email}`, kind: "email", icon: LINK_ICONS.email! });
  if (c.website) links.push({ label: "Sitio web", url: c.website, kind: "website", icon: LINK_ICONS.website!, external: true });

  // "Ver mi sitio": la mini-web que GENERAMOS para el lead (build-web), NO
  // confundir con "Sitio web" arriba (el sitio PROPIO que el negocio ya tenia
  // antes de que lo carguemos, dato de contact.website). Gateado por status:
  // ver hasGeneratedWebsite.
  const hasGeneratedWeb = hasGeneratedWebsite(lead.status);
  const generatedWebUrl = hasGeneratedWeb ? GENERATED_WEB_REL_URL : "";
  if (hasGeneratedWeb) {
    links.push({
      label: "Ver mi sitio",
      url: generatedWebUrl,
      kind: "generated-web",
      icon: LINK_ICONS.website!,
      external: true,
    });
  }

  if (s.instagram) links.push({ label: "Instagram", url: socialUrl("instagram", s.instagram), kind: "instagram", icon: LINK_ICONS.instagram!, external: true });
  if (s.facebook) links.push({ label: "Facebook", url: socialUrl("facebook", s.facebook), kind: "facebook", icon: LINK_ICONS.facebook!, external: true });
  if (s.tiktok) links.push({ label: "TikTok", url: socialUrl("tiktok", s.tiktok), kind: "tiktok", icon: LINK_ICONS.tiktok!, external: true });

  /* ---------- contacto plano (disenos nuevos: campos discretos) ---------- */
  const primaryPhone = phones[0];
  const hasPhone = Boolean(primaryPhone);
  const phoneDisplay = primaryPhone ?? "";
  const phoneTelHref = primaryPhone ? `tel:${primaryPhone.replace(/[^\d+]/g, "")}` : "";

  const hasEmail = Boolean(c.email);
  const hasWebsite = Boolean(c.website);

  const addressLines = (c.address ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hasAddressLine = addressLines.length > 0;
  const addressLine = addressLines.join(", ");
  const mapsUrl = c.address ? buildMapsUrl(c.address) : "";

  const hasInstagram = Boolean(s.instagram);
  const instagramUrl = s.instagram ? socialUrl("instagram", s.instagram) : "";
  const hasFacebook = Boolean(s.facebook);
  const facebookUrl = s.facebook ? socialUrl("facebook", s.facebook) : "";
  const hasTiktok = Boolean(s.tiktok);
  const tiktokUrl = s.tiktok ? socialUrl("tiktok", s.tiktok) : "";
  const hasSocials = hasInstagram || hasFacebook || hasTiktok;

  const services = lead.content.services;
  const hasServices = services.length > 0;
  const servicesNumbered = services.map((svc, i) => ({ n: String(i + 1).padStart(2, "0"), name: svc }));

  const attrs = Object.entries(lead.business.attrs).map(([key, value]) => ({ key, value }));
  const hasAttrs = attrs.length > 0;

  /* ---------- tema ---------- */
  // primary/secondary/accent: SIEMPRE presentes (carga estructural de todo
  // diseno del pool). Par color+texto; el texto legible viene de
  // brand.colorsText (WCAG, calculado en verify) — aca NO se recalcula. Si
  // falta un color se usa el par de reserva completo, para no mezclar el texto
  // de un color con el fondo de otro.
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

  // background/surface (superficie) + text (tinta): roles OPCIONALES que asigna
  // el LLM pero PUEDEN faltar (ej. tarjeta blanca => ignoreWhite descarta el
  // blanco de fondo y `background` viene null). NO llevan par de reserva: si
  // faltan, cada template cae a su PROPIO valor de diseno via
  // `var(--rol,<default-del-diseno>)`, preservando su identidad (dark sigue
  // oscuro, clinic sigue claro). Por eso solo se exponen en `colors` cuando
  // existen, con un flag `hasX` para el `{{#hasX}}` del template. `text` es
  // TINTA, no superficie => no lleva colorsText (no se pinta nada encima).
  const surfaceTheme: Record<string, boolean> = {};
  for (const role of ["background", "surface", "text"] as const) {
    const measured = lead.brand.colors[role];
    surfaceTheme[`has${role[0]!.toUpperCase()}${role.slice(1)}`] = Boolean(measured);
    if (!measured) continue;
    colors[role] = measured;
    if (role !== "text") {
      // colorsText ya viene de verify; si un data.json viejo no lo trae, se
      // deriva del hex con la MISMA funcion WCAG que usa verify (no se duplica
      // la logica). textColorFor es undefined solo si el hex es invalido.
      colorsText[role] = lead.brand.colorsText?.[role] ?? textColorFor(measured) ?? "#000000";
    }
  }

  // Direccion (diseno credencial): lineas visibles + boton "Como llegar".
  const address = addressLines.length
    ? { lines: addressLines, mapsUrl: buildMapsUrl(c.address!), mapsIcon: LINK_ICONS.maps! }
    : null;

  return {
    // --- identidad ---
    slug: lead.slug,
    name,
    personName,
    tagline,
    heroName,
    orgName,
    hasOrgLine,
    // avatar: cascada foto -> logo -> inicial. `photoPath` tiene prioridad; si
    // falta, el template cae al logo, y si tampoco hay, a la inicial. Nunca una
    // cara generada: photo_path/logo_path son material real del negocio.
    photoPath: lead.brand.photo_path ?? "",
    logoPath: lead.brand.logo_path ?? "",
    initial,
    fontFamily: resolveFontFamily(lead.brand.font_hint),

    // --- credencial: lista generica de enlaces ---
    links,
    hasLinks: links.length > 0,
    whatsapp: waUrl ? { url: waUrl, icon: LINK_ICONS.whatsapp! } : null,
    address,
    about: lead.content.about ?? "",

    // --- disenos nuevos: contacto plano ---
    hasPhone,
    phoneDisplay,
    phoneTelHref,
    whatsappUrl: waUrl ?? "",
    hasEmail,
    email: c.email ?? "",
    hasWebsite,
    website: c.website ?? "",
    hasGeneratedWeb,
    generatedWebUrl,
    hasAddressLine,
    addressLine,
    mapsUrl,
    hasSocials,
    hasInstagram,
    instagramUrl,
    hasFacebook,
    facebookUrl,
    hasTiktok,
    tiktokUrl,

    // --- servicios / atributos ---
    services,
    hasServices,
    servicesNumbered,
    attrs,
    hasAttrs,

    // --- tema ---
    colors,
    colorsText,
    ...surfaceTheme, // hasBackground / hasSurface / hasText



    // --- meta / extras ---
    jsonLd: buildJsonLd(lead),
    year,
    pageTitle: tagline ? `${name} — ${tagline}` : name,
    metaDescription: tagline || lead.content.about || `Contacto y servicios de ${name}`,
  };
}

/* ------------------------------------------------------------------ */
/* Pool de templates                                                   */
/* ------------------------------------------------------------------ */

const DC_TEMPLATES_DIR = new URL("../dc-templates/", import.meta.url);
const DC_ASSETS_DIR = new URL(`../dc-templates/${ASSETS_DIR}/`, import.meta.url);

interface PoolEntry {
  /** Nombre del diseno, sin extension (ej. "clinic"). */
  key: string;
  /** Nombre de archivo en el pool (ej. "clinic.html"). */
  file: string;
}

/**
 * Recorre `src/dc-templates/` y devuelve todos los `*.html` que NO empiecen
 * con "_" (ese prefijo queda reservado para el propio visor). Orden
 * alfabetico por nombre de archivo — asi agregar un diseno nuevo es tirar el
 * archivo en la carpeta, sin tocar codigo.
 */
async function listTemplatePool(): Promise<PoolEntry[]> {
  const dir = fileURLToPath(DC_TEMPLATES_DIR);
  const entries = await fs.readdir(dir);
  return entries
    .filter((f) => f.endsWith(".html") && !f.startsWith("_"))
    .sort()
    .map((file) => ({ key: file.replace(/\.html$/, ""), file }));
}

/**
 * orderPoolByRubro — mueve al frente el diseno preferido para el rubro del
 * lead (`RUBRO_TEMPLATE_ORDER`), asi es el primero que ve el cliente al
 * abrir el visor. El resto conserva su orden alfabetico. Si el diseno
 * preferido no esta en el pool (se borro el archivo) o ya esta primero,
 * devuelve el pool sin tocar.
 */
export function orderPoolByRubro(pool: PoolEntry[], rubro: Rubro): PoolEntry[] {
  const preferredKey = RUBRO_TEMPLATE_ORDER[rubro];
  const idx = pool.findIndex((p) => p.key === preferredKey);
  if (idx <= 0) return pool;
  return [pool[idx]!, ...pool.slice(0, idx), ...pool.slice(idx + 1)];
}

async function loadPoolTemplate(file: string): Promise<string> {
  return fs.readFile(fileURLToPath(new URL(file, DC_TEMPLATES_DIR)), "utf8");
}

async function loadViewerTemplate(): Promise<string> {
  return fs.readFile(fileURLToPath(new URL("_viewer.html", DC_TEMPLATES_DIR)), "utf8");
}

/**
 * loadMotifs — lee `_motifs.html` (la libreria de motivos) y devuelve el mapa
 * rubro -> bloque. Si el archivo no existe (pool sin la libreria) devuelve un
 * mapa vacio: `swapMotif` cae a no-op y cada template conserva su bloque
 * default. `_motifs.html` empieza con "_" => no entra al pool.
 */
async function loadMotifs(): Promise<Record<string, string>> {
  try {
    const html = await fs.readFile(fileURLToPath(new URL("_motifs.html", DC_TEMPLATES_DIR)), "utf8");
    return parseMotifs(html);
  } catch {
    return {};
  }
}

/** Etiqueta legible + publico objetivo para un diseno del pool en el visor. */
function labelFor(key: string): { name: string; audience: string } {
  return CARD_LABELS[key] ?? { name: key.charAt(0).toUpperCase() + key.slice(1), audience: "" };
}

/**
 * build-cards — etapa CLI. Exige status "verified" o posterior (guard ANTES
 * de tocar disco). Rellena CADA template del pool con los datos del lead y
 * escribe `leads/<slug>/dc/<template>.html`, mas el visor swipeable en
 * `leads/<slug>/dc/index.html`. Avanza el status a "linktree_built" solo si
 * el lead no estaba ya mas adelante (regenerar el artefacto no retrocede el
 * pipeline; el nombre del estado se mantiene por compatibilidad con leads ya
 * en curso).
 */
export async function buildCards(slug: string): Promise<string[]> {
  if (!slug) throw new Error("build-cards: falta el slug. Uso: build-cards <slug>");

  const lead = await readLead(slug);
  assertBuildableStatus(lead.status);

  const pool = await listTemplatePool();
  if (pool.length === 0) {
    throw new Error("build-cards: src/dc-templates/ no tiene ningun template (*.html sin prefijo _)");
  }
  const orderedPool = orderPoolByRubro(pool, lead.rubro);

  // Fondo decorativo intercambiable: el bloque de motivos del rubro del lead se
  // inyecta en CADA diseno del pool (fallback al bloque "otro", y si tampoco
  // esta, cada template conserva su motivo default).
  const motifs = await loadMotifs();
  const motifBlock = motifs[lead.rubro] ?? motifs.otro;

  const view = buildCardView(lead);
  const writtenPaths: string[] = [];
  const cards: { template: string; path: string }[] = [];

  for (const entry of orderedPool) {
    const rawTemplate = await loadPoolTemplate(entry.file);
    const template = swapMotif(rawTemplate, motifBlock);
    const rendered = renderTemplate(template, view);
    const html = injectBrandToggle(rendered);
    const relPath = path.posix.join(DC_DIR, entry.file);
    const outPath = await writeArtifact(slug, relPath, html);
    writtenPaths.push(outPath);
    cards.push({ template: entry.key, path: relPath });
  }

  const viewerTemplate = await loadViewerTemplate();
  const viewerView = {
    cards: orderedPool.map((entry) => {
      const label = labelFor(entry.key);
      return { file: entry.file, name: label.name, audience: label.audience };
    }),
    // Gatea el paso "Tu propia página web" de la vista guiada: solo se muestra
    // si el lead ya paso por build-web (mismo criterio que el link "Ver mi
    // sitio" de cada card). Antes de eso, prometer una web daria un 404.
    hasGeneratedWeb: hasGeneratedWebsite(lead.status),
  };
  const viewerHtml = renderTemplate(viewerTemplate, viewerView);
  const viewerRelPath = path.posix.join(DC_DIR, VIEWER_FILE);
  const viewerPath = await writeArtifact(slug, viewerRelPath, viewerHtml);
  writtenPaths.push(viewerPath);

  // Assets compartidos (imagenes de los disenos guelaguetza-*): se espejan en
  // `dc/assets/` para que sus rutas relativas resuelvan en el iframe. No-op si
  // el pool no trae carpeta de assets.
  const assetsDest = await copyTreeIntoLead(
    slug,
    fileURLToPath(DC_ASSETS_DIR),
    path.posix.join(DC_DIR, ASSETS_DIR),
  );
  if (assetsDest) writtenPaths.push(assetsDest);

  const order = StatusSchema.options;
  const status: Status =
    order.indexOf(lead.status) < order.indexOf("linktree_built") ? "linktree_built" : lead.status;

  await writeLead({
    ...lead,
    status,
    generated: { ...lead.generated, dc_url: viewerRelPath, cards },
  });

  return writtenPaths;
}

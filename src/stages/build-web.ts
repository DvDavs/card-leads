import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEB_LABELS, WEB_TEMPLATE_ORDER, rubroConfig } from "../config/rubro-map.js";
import { textColorFor } from "../lib/colors.js";
import {
  StatusSchema,
  type Lead,
  type PersonGender,
  type Rubro,
  type Status,
} from "../lib/schema.js";
import { renderTemplate } from "../lib/template.js";
import { copyFilesIntoLead, readLead, writeArtifact, writeLead } from "../lib/storage.js";
import {
  FALLBACK_THEME,
  WHATSAPP_PREFILL,
  buildMapsUrl,
  deriveWhatsappNumber,
  injectBrandToggle,
  socialUrl,
} from "./build-cards.js";

/**
 * build-web — rellena TODAS las plantillas web del rubro del lead con los
 * datos REALES + el copy que ya produjo `enrich` (`content.generated_copy`,
 * se LEE de disco, NO se regenera), escribe `leads/<slug>/web/<archivo>.html`
 * y arma un visor swipeable en `leads/<slug>/web/index.html` para que el
 * cliente elija diseno (mismo patron que build-cards).
 *
 * El pool se arma por GLOB (contrato `src/templates/doctor/_BRIEF-web-doctor.md`
 * §1): todo `*.html` de `src/templates/<carpeta-del-rubro>/` que NO empiece
 * con "_" es una plantilla activa. El filesystem es el manifest — sumar una
 * plantilla = tirar el archivo en la carpeta, sin tocar codigo. Todas las
 * plantillas consumen el MISMO objeto view (el registro UNION del brief §3):
 * cada una usa solo las claves que su diseno necesita, y todo dato opcional
 * va con su guard `tiene_x` (cero campos vacios).
 *
 * Las imagenes salen del BANCO del rubro (`src/templates/<carpeta>/assets/` +
 * manifest.json): `resolveWebImages` elige por kind/genero con seed
 * determinista y solo las consumidas se copian a `leads/<slug>/web/assets/`.
 * Cero fotos de personas que no sean material del banco o del negocio real.
 *
 * A diferencia de las digital cards, la web NO necesita ser self-contained:
 * Tailwind CDN, iconify y Google Fonts estan permitidos.
 */

const WEB_DIR = "web";
const WEB_FILE = "index.html";
/** Subcarpeta del banco de imagenes del rubro y de su espejo en el lead. */
const ASSETS_DIR = "assets";
/** Manifest del banco: lista {tag,file,kind,gender?} de cada imagen. */
const MANIFEST_FILE = "manifest.json";
/** Nombre del visor swipeable dentro de la carpeta del rubro (prefijo _ = fuera del pool). */
const VIEWER_TEMPLATE = "_viewer.html";

const WEB_TEMPLATES_DIR = new URL("../templates/", import.meta.url);

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
 * EJEMPLO (no reales). El view la expone como `testimonios_son_ejemplo` por si
 * un diseno quiere atenuar esa seccion; el aviso global es `demo_es_ejemplo`.
 */
const SAMPLE_TESTIMONIALS_KEY = "testimonials";

/** CTA fijo del hero (brief §3a: texto del boton principal, nunca vacio). */
const DEFAULT_HERO_CTA = "Agendar cita";
/** Titular de reserva de la seccion CTA final (nunca vacio). */
const DEFAULT_CTA_TITULO = "Contactanos";

/**
 * Rol legible de la persona titular por rubro, para `doctor_cita.rol` cuando
 * el lead no trae tagline. Es TEXTO visible (puede llevar tildes); las CLAVES
 * del view son las que deben ser ASCII (brief §2a).
 */
const RUBRO_PERSON_ROLE: Record<Rubro, string> = {
  doctor: "Médico titular",
  barberia: "Barbero titular",
  estetica: "Especialista titular",
  veterinario: "Veterinario titular",
  nutriologo: "Nutriólogo titular",
  otro: "Titular",
};

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
 * usarla dentro de `leads/<slug>/web/*.html`. La web vive un nivel bajo la
 * carpeta del lead, asi que una ruta relativa al lead necesita subir uno
 * (`../`). Las data URI y URLs absolutas se dejan intactas. Cadena vacia si no
 * hay ruta.
 */
export function webAssetSrc(p: string | undefined): string {
  if (!p) return "";
  if (/^(data:|https?:\/\/)/i.test(p)) return p;
  return "../" + p.replace(/^\.?\//, "");
}

/**
 * normalizeText — PURA: minusculas + sin acentos (NFD sin diacriticos), para
 * matchear palabras clave sin depender de tildes/mayusculas ("Odontología" ->
 * "odontologia").
 */
function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Palabras que marcan a un lead como odontologico. El rubro sigue siendo
 * `doctor` (cubre CUALQUIER especialidad medica); esto solo distingue el
 * SUB-rubro dental para elegir imagenes del banco acordes. Ver detectSpecialty.
 */
const DENTAL_KEYWORDS = [
  "dental",
  "dentista",
  "dentist",
  "odontolog",
  "odontopediatr",
  "ortodon",
  "endodon",
  "periodon",
  "estomatolog",
  "implantolog",
];

/**
 * detectSpecialty — PURA: infiere el sub-rubro del banco (`WebSpecialty`) a
 * partir de los datos REALES del lead (nombre, tagline, servicios, highlights,
 * about, atributos). Devuelve "dental" si algun campo menciona odontologia; si
 * no, "general". NO mira el copy generado por el LLM (`generated_copy` es
 * muestra); solo dato real del negocio. Determinista: mismo lead -> misma
 * especialidad, sin `Math.random`.
 */
export function detectSpecialty(lead: Lead): WebSpecialty {
  const haystack = normalizeText(
    [
      lead.business.name,
      lead.business.tagline ?? "",
      lead.content.about ?? "",
      ...(lead.content.services ?? []),
      ...(lead.content.highlights ?? []),
      ...Object.values(lead.business.attrs ?? {}),
    ].join(" "),
  );
  return DENTAL_KEYWORDS.some((k) => haystack.includes(k)) ? "dental" : "general";
}

/**
 * fnv1a — hash FNV-1a de 32 bits, PURO y determinista. Es la semilla de la
 * seleccion de imagenes: mismo `slug:slot` -> mismo indice -> mismo archivo,
 * en cualquier maquina y corrida (no hay Math.random en el pipeline).
 */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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
/* Banco de imagenes                                                   */
/* ------------------------------------------------------------------ */

/**
 * Sub-rubro del banco de imagenes dentro del rubro `doctor`: "general"
 * (medicina general/cualquier especialidad no dental) o "dental" (odontologia).
 * Es el equivalente a `gender` pero para el TIPO de negocio: `resolveWebImages`
 * prefiere las imagenes cuya especialidad coincide con la del lead (detectada
 * por `detectSpecialty`), con fallback a "general" si no hay stock. Una imagen
 * sin `specialty` en el manifest se trata como "general".
 */
export type WebSpecialty = "general" | "dental";

/** Una imagen del banco del rubro, tal como la describe manifest.json. */
export interface WebImage {
  /** Nombre legible/estable, usado para ordenar candidatos (estabilidad). */
  tag: string;
  /** Nombre de archivo dentro de assets/ (ej. "RetratoDoctor01.png"). */
  file: string;
  /** Categoria: "retrato" | "consultorio" | "equipo" | "sonrisa" | "recepcion". */
  kind: string;
  /** Solo retratos: genero de la persona retratada. */
  gender?: PersonGender;
  /** Sub-rubro: "general" (default si se omite) | "dental". Ver WebSpecialty. */
  specialty?: WebSpecialty;
}

export interface WebImageManifest {
  images: WebImage[];
}

/** Resultado de `resolveWebImages`: valores por slot + archivos a copiar. */
export interface ResolvedWebImages {
  /**
   * Slot -> valor listo para `src` del template. Imagenes del banco quedan
   * como `assets/<File>` (relativas a web/); la foto real del lead queda como
   * `../<file>` (via webAssetSrc). Incluye los slots por miembro del equipo
   * demo (`img_team_01`..`img_team_NN`), que buildWebView reparte en
   * `nuestro_equipo[].img`.
   */
  slots: Record<string, string>;
  /** Archivos del banco CONSUMIDOS (dedupe por destino), listos para copyFilesIntoLead. */
  files: { from: string; to: string }[];
}

/** Slots fijos del registro (brief §3c). Siempre presentes en el view (peor caso ""). */
const WEB_IMAGE_SLOTS = [
  "img_retrato_principal",
  "img_hero_01",
  "img_hero_02",
  "img_consultorio_01",
  "img_consultorio_02",
  "img_equipo_01",
  "img_sonrisa_01",
  "img_recepcion_01",
  "img_avatar_01",
  "img_avatar_02",
  "img_avatar_03",
] as const;

/** Clave del slot de retrato por miembro del equipo demo (01-based). */
function teamSlotKey(index: number): string {
  return `img_team_${String(index + 1).padStart(2, "0")}`;
}

/**
 * resolveWebImages — PURA: elige del banco del rubro una imagen por slot del
 * registro (§3c) y devuelve `{slots, files}`. Sin I/O: el manifest y la ruta
 * del banco entran por parametro; la copia fisica la hace buildWeb con
 * `copyFilesIntoLead`.
 *
 * Reglas:
 * - Seleccion DETERMINISTA con semilla: `fnv1a(slug + ":" + slot) % candidatos`,
 *   con los candidatos ordenados por `tag` (estabilidad ante manifest
 *   desordenado). Mismo lead -> mismas fotos, siempre.
 * - Cada slot filtra por `kind`; los retratos ademas por genero cuando se
 *   conoce Y hay candidatos de ese genero (si no, cae a kind-only).
 * - `img_retrato_principal`: si el lead trae foto REAL (`brand.photo_path`),
 *   el slot apunta a ella (`../<file>`) y NO se consume banco para ese slot.
 * - Slots "hermanos" (hero 01/02, consultorio 01/02, avatares, retratos del
 *   equipo) evitan repetirse entre si mientras queden candidatos; los
 *   avatares y el equipo ademas excluyen el retrato principal.
 * - `files` lista SOLO lo consumido, deduplicado, con destino
 *   `web/assets/<File>`.
 */
export function resolveWebImages(
  lead: Lead,
  manifest: WebImageManifest,
  bankDir: string,
): ResolvedWebImages {
  const images = manifest.images ?? [];
  const slots: Record<string, string> = {};
  const consumed = new Map<string, { from: string; to: string }>();

  /** Registra la eleccion: valor del slot + archivo consumido (dedupe). */
  const use = (slot: string, img: WebImage | undefined): WebImage | undefined => {
    if (!img) {
      slots[slot] = "";
      return undefined;
    }
    slots[slot] = `${ASSETS_DIR}/${img.file}`;
    if (!consumed.has(img.file)) {
      consumed.set(img.file, {
        from: path.join(bankDir, img.file),
        to: path.posix.join(WEB_DIR, ASSETS_DIR, img.file),
      });
    }
    return img;
  };

  // Sub-rubro del lead (general | dental). byKind PREFIERE las imagenes de esa
  // especialidad y cae a todo el kind si el banco no tiene stock de ese
  // sub-rubro (mismo criterio de fallback que el genero en retratosDe). Una
  // imagen sin `specialty` cuenta como "general".
  const specialty = detectSpecialty(lead);
  const byKind = (...kinds: string[]): WebImage[] => {
    const ofKind = images.filter((i) => kinds.includes(i.kind));
    const preferred = ofKind.filter((i) => (i.specialty ?? "general") === specialty);
    return preferred.length ? preferred : ofKind;
  };

  /**
   * Eleccion sembrada con exclusiones en dos niveles: `avoid` son los archivos
   * ya usados por slots hermanos (se relaja si agota el pool); `hardAvoid` es
   * el retrato principal (solo se relaja si no queda NINGUN candidato).
   */
  const pick = (
    slot: string,
    candidates: WebImage[],
    avoid: ReadonlySet<string> = new Set(),
    hardAvoid: ReadonlySet<string> = new Set(),
  ): WebImage | undefined => {
    const sinPrincipal = candidates.filter((i) => !hardAvoid.has(i.file));
    const base = sinPrincipal.length ? sinPrincipal : candidates;
    const libres = base.filter((i) => !avoid.has(i.file));
    const pool = libres.length ? libres : base;
    if (!pool.length) return undefined;
    const sorted = [...pool].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
    return sorted[fnv1a(`${lead.slug}:${slot}`) % sorted.length];
  };

  const retratos = byKind("retrato");
  /** Retratos del genero pedido; si no hay (o no se conoce), kind-only. */
  const retratosDe = (gender: PersonGender | undefined): WebImage[] => {
    if (!gender) return retratos;
    const filtrados = retratos.filter((i) => i.gender === gender);
    return filtrados.length ? filtrados : retratos;
  };

  // 1) Retrato principal: foto real del lead > banco por genero.
  const principalSet = new Set<string>();
  if (lead.brand.photo_path) {
    slots.img_retrato_principal = webAssetSrc(lead.brand.photo_path);
  } else {
    const principal = use(
      "img_retrato_principal",
      pick("img_retrato_principal", retratosDe(lead.business.person_gender)),
    );
    if (principal) principalSet.add(principal.file);
  }

  // 2) Hero: instalaciones (consultorio + recepcion), 01 y 02 distintas.
  const heroPool = byKind("consultorio", "recepcion");
  const hero1 = use("img_hero_01", pick("img_hero_01", heroPool));
  use("img_hero_02", pick("img_hero_02", heroPool, new Set(hero1 ? [hero1.file] : [])));

  // 3) Consultorios 01/02 distintos + kinds simples.
  const consultorios = byKind("consultorio");
  const c1 = use("img_consultorio_01", pick("img_consultorio_01", consultorios));
  use("img_consultorio_02", pick("img_consultorio_02", consultorios, new Set(c1 ? [c1.file] : [])));
  use("img_equipo_01", pick("img_equipo_01", byKind("equipo")));
  use("img_sonrisa_01", pick("img_sonrisa_01", byKind("sonrisa")));
  use("img_recepcion_01", pick("img_recepcion_01", byKind("recepcion")));

  // 4) Avatares: retratos mixtos, sin el principal, distintos entre si.
  const avatarUsed = new Set<string>();
  for (const slot of ["img_avatar_01", "img_avatar_02", "img_avatar_03"]) {
    const img = use(slot, pick(slot, retratos, avatarUsed, principalSet));
    if (img) avatarUsed.add(img.file);
  }

  // 5) Equipo demo: retrato por miembro segun SU genero, sin el principal y
  //    sin repetirse entre miembros mientras haya candidatos.
  const teamUsed = new Set<string>();
  const team = lead.content.generated_copy?.demo?.team ?? [];
  team.forEach((member, i) => {
    const slot = teamSlotKey(i);
    const img = use(slot, pick(slot, retratosDe(member.gender), teamUsed, principalSet));
    if (img) teamUsed.add(img.file);
  });

  return { slots, files: [...consumed.values()] };
}

/* ------------------------------------------------------------------ */
/* Vista pura (registro UNION en espanol, brief §3)                    */
/* ------------------------------------------------------------------ */

const EMPTY_IMAGES: ResolvedWebImages = { slots: {}, files: [] };

/**
 * buildWebView — funcion PURA: Lead (+ anio + imagenes resueltas) -> objeto de
 * template UNICO para todo el pool del rubro. Implementa el registro UNION del
 * brief (§3a universales, §3b unicos de seccion, §3c slots de imagen): claves
 * en ESPANOL y ASCII (`anio`, `mision`, `resenas` — sin tildes ni enie, §2a),
 * todo dato opcional acompanado de su guard `tiene_x` para que ningun campo
 * se muestre vacio. Un dato ausente no aparece como "undefined": su seccion
 * simplemente no renderiza.
 *
 * Todo lo INTERPRETATIVO (colores medidos, copy generado) ya viene del lead;
 * aca solo se derivan datos deterministas. `year` e `images` son parametros
 * para que los tests fijen la salida.
 */
export function buildWebView(
  lead: Lead,
  year: number = new Date().getFullYear(),
  images: ResolvedWebImages = EMPTY_IMAGES,
): Record<string, unknown> {
  const b = lead.business;
  const c = lead.contact;
  const s = lead.socials;
  const gc = lead.content.generated_copy;
  const demo = gc?.demo;

  /* ---------- identidad ---------- */
  // Nombre a mostrar: persona -> negocio -> slug. Nunca vacio (h1 de la mayoria).
  const nombre = b.person_name || b.name || lead.slug;
  const inicial = (b.person_name?.trim() || b.name.trim() || lead.slug).charAt(0).toUpperCase();
  const tagline = b.tagline ?? "";
  const tieneTagline = Boolean(tagline);

  /* ---------- contacto (datos REALES del lead, nunca del LLM) ---------- */
  const primaryPhone = c.phones?.[0];
  const tieneTelefono = Boolean(primaryPhone);
  // telefono_href: SOLO digitos y "+" (brief §3a); el template pone el "tel:".
  const telefonoHref = primaryPhone ? primaryPhone.replace(/[^\d+]/g, "") : "";

  const waNumber = deriveWhatsappNumber(c);
  const whatsappUrl = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(WHATSAPP_PREFILL)}`
    : "";

  const direccion = (c.address ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ");
  const tieneDireccion = direccion !== "";
  const mapaUrl = c.address ? buildMapsUrl(c.address) : "";
  // mapa_embed_url: uno de los DOS unicos campos crudos del registro (§2d).
  // encodeURIComponent deja la URL segura para interpolarse sin escape.
  const mapaEmbedUrl = tieneDireccion
    ? `https://www.google.com/maps?q=${encodeURIComponent(direccion)}&output=embed`
    : "";

  // Horario: `contact.hours` es un string ("Lun a Vie 9-18, Sab 9-14"); se
  // parte por coma en lineas. Puede ser el default por rubro (no confirmado)
  // => flag referencial para marcarlo visualmente.
  const horarioLineas = (c.hours ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

  const tieneInstagram = Boolean(s.instagram);
  const tieneFacebook = Boolean(s.facebook);
  const tieneTiktok = Boolean(s.tiktok);

  /* ---------- credenciales y servicios reales ---------- */
  // Credenciales: business.attrs tal cual ({clave, valor}); limpiar el formato
  // es tarea del humano en verify, no de esta etapa.
  const credenciales = Object.entries(b.attrs).map(([clave, valor]) => ({ clave, valor }));

  // Servicios REALES (autoridad = verify) casados por nombre con su
  // descripcion generada; sin descripcion se muestran igual (solo nombre).
  const descByName = new Map(
    (gc?.service_descriptions ?? []).map((d) => [d.name, d.description] as const),
  );
  const servicios = lead.content.services.map((name, i) => ({
    n: String(i + 1).padStart(2, "0"),
    nombre: name,
    descripcion: descByName.get(name) ?? "",
    tiene_descripcion: descByName.has(name),
  }));

  /* ---------- copy de marketing (generated_copy) ---------- */
  const heroTitulo = gc?.hero_headline || tagline || nombre;
  const bio = gc?.bio ?? "";
  const citaDestacada = gc?.pull_quote ?? "";

  const propuestas = (gc?.value_props ?? []).map((v) => ({
    titulo: v.title,
    descripcion: v.description,
  }));

  const testimonios = (gc?.testimonials ?? []).map((t) => ({
    cita: t.quote,
    autor: t.author,
    rol: t.role ?? "",
    tiene_rol: Boolean(t.role),
  }));

  // FAQ: max 9 (brief §3b); el orden del copy se respeta.
  const faq = (gc?.faqs ?? []).slice(0, 9).map((f) => ({
    pregunta: f.question,
    respuesta: f.answer,
  }));

  const ctaTitulo = gc?.cta_headline || DEFAULT_CTA_TITULO;
  const ctaSubtexto = gc?.cta_subtext ?? "";
  // footer_bio nunca vacio: copy -> tagline -> nombre (regla "cero campos vacios").
  const footerBio = gc?.footer_tagline || tagline || nombre;

  /* ---------- contenido demo (generated_copy.demo, TODO con guard) ---------- */
  // Stats: max 4 (brief §3b) — es lo que los layouts esperan.
  const stats = (demo?.stats ?? []).slice(0, 4).map((st) => ({
    valor: st.value,
    etiqueta: st.label,
  }));

  // Equipo demo: 5 miembros; la card CENTRAL (indice 2) va destacada. El
  // retrato de cada miembro ya viene resuelto por genero en images.slots.
  const teamMembers = demo?.team ?? [];
  const nuestroEquipo = teamMembers.map((m, i) => ({
    nombre: m.name,
    rol: m.role,
    img: images.slots[teamSlotKey(i)] ?? "",
    destacado: i === 2,
  }));

  const experiencia = (demo?.experience ?? []).map((e) => ({
    puesto: e.role,
    lugar: e.place,
    periodo: e.period,
    descripcion: e.description,
    actual: e.current,
  }));

  const educacion = (demo?.education ?? []).map((e) => ({
    titulo: e.degree,
    institucion: e.institution,
    periodo: e.period,
    detalles: e.details,
  }));

  const investigacion = (demo?.research ?? []).map((r) => ({
    etiqueta: r.tag,
    titulo: r.title,
    descripcion: r.description,
  }));

  const habilidades = demo?.skills ?? [];
  const idiomas = (demo?.languages ?? []).map((l) => ({ idioma: l.language, nivel: l.level }));
  const mision = demo?.mission ?? "";
  const educacionPaciente = (demo?.patient_education ?? []).map((p) => ({
    titulo: p.title,
    descripcion: p.description,
  }));

  const sedacion = demo?.sedation
    ? {
        titulo: demo.sedation.title,
        descripcion: demo.sedation.description,
        puntos: demo.sedation.points,
      }
    : null;

  const higienePuntos = (demo?.hygiene ?? []).map((h) => ({
    titulo: h.title,
    descripcion: h.description,
  }));

  const ctaUrgencia = demo?.urgency
    ? { titulo: demo.urgency.headline, subtexto: demo.urgency.subtext }
    : null;

  const badgeDisponibilidad = demo?.availability_badge ?? "";
  const calificacion = demo?.rating
    ? { valor: demo.rating.value, resenas: demo.rating.count_label }
    : null;
  const confianzaItems = demo?.trust_items ?? [];

  /* ---------- derivados del LEAD real (no demo) ---------- */
  // Firma de la cita destacada (doc-lujo): persona real + rol por tagline/rubro.
  const doctorCita = b.person_name
    ? { nombre: b.person_name, rol: tagline || RUBRO_PERSON_ROLE[lead.rubro] }
    : null;

  // Responsable tecnico (doc-urgencias): persona real + su cedula si esta en
  // attrs. Solo aparece cuando hay persona (dato real, nunca inventado).
  const cedula = Object.entries(b.attrs).find(([k]) => /c[eé]dula/i.test(k));
  const responsableTecnico = b.person_name
    ? cedula
      ? `${b.person_name} — ${cedula[0]} ${cedula[1]}`
      : b.person_name
    : "";

  // Aviso demo global (§6): se enciende cuando el copy trae contenido de
  // muestra registrado en sample_fields (testimonios, bloque demo, etc.).
  const demoEsEjemplo = (gc?.sample_fields?.length ?? 0) > 0;

  /* ---------- tema (colores medidos, patron dc, en ingles a proposito) ---------- */
  // primary/secondary/accent: siempre presentes (par color+texto legible WCAG,
  // calculado en verify — aca NO se recalcula). Si falta un rol se usa el par
  // de reserva completo, para no mezclar texto de un color con fondo de otro.
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
  // background/surface: roles OPCIONALES medidos; sin par de reserva. Si
  // faltan, cada template cae a su propio default via `var(--x, <default>)`.
  const surfaceFlags: Record<string, boolean> = {};
  for (const role of ["background", "surface"] as const) {
    const measured = lead.brand.colors[role];
    surfaceFlags[`has${role[0]!.toUpperCase()}${role.slice(1)}`] = Boolean(measured);
    if (!measured) continue;
    colors[role] = measured;
    colorsText[role] = lead.brand.colorsText?.[role] ?? textColorFor(measured) ?? "#000000";
  }

  /* ---------- meta ---------- */
  const metaTitulo = gc?.meta_title || (tagline ? `${nombre} — ${tagline}` : nombre);
  const metaDescripcion =
    gc?.meta_description || tagline || bio || `Informacion y contacto de ${nombre}`;

  /* ---------- slots de imagen (§3c): siempre presentes, peor caso "" ---------- */
  const imageSlots: Record<string, string> = {};
  for (const slot of WEB_IMAGE_SLOTS) imageSlots[slot] = images.slots[slot] ?? "";

  return {
    // --- identidad ---
    nombre,
    inicial,
    tagline,
    tiene_tagline: tieneTagline,

    // --- meta ---
    meta_titulo: metaTitulo,
    meta_descripcion: metaDescripcion,

    // --- hero ---
    hero_badge: gc?.hero_badge ?? "",
    tiene_hero_badge: Boolean(gc?.hero_badge),
    hero_titulo: heroTitulo,
    hero_subtitulo: gc?.hero_subheadline ?? "",
    tiene_hero_subtitulo: Boolean(gc?.hero_subheadline),
    hero_cta: DEFAULT_HERO_CTA,

    // --- cuerpo / sobre ---
    bio,
    tiene_bio: Boolean(bio),
    cita_destacada: citaDestacada,
    tiene_cita_destacada: Boolean(citaDestacada),

    // --- contacto (datos reales) ---
    telefono: primaryPhone ?? "",
    telefono_href: telefonoHref,
    tiene_telefono: tieneTelefono,
    whatsapp_url: whatsappUrl,
    tiene_whatsapp: whatsappUrl !== "",
    email: c.email ?? "",
    tiene_email: Boolean(c.email),
    direccion,
    tiene_direccion: tieneDireccion,
    mapa_url: mapaUrl,
    mapa_embed_url: mapaEmbedUrl,

    // --- horario ---
    horario_lineas: horarioLineas,
    tiene_horario: horarioLineas.length > 0,
    horario_referencial: hoursAreReferential(lead),

    // --- redes ---
    instagram_url: s.instagram ? socialUrl("instagram", s.instagram) : "",
    tiene_instagram: tieneInstagram,
    facebook_url: s.facebook ? socialUrl("facebook", s.facebook) : "",
    tiene_facebook: tieneFacebook,
    tiktok_url: s.tiktok ? socialUrl("tiktok", s.tiktok) : "",
    tiene_tiktok: tieneTiktok,
    tiene_redes: tieneInstagram || tieneFacebook || tieneTiktok,

    // --- credenciales / servicios / propuestas ---
    credenciales,
    tiene_credenciales: credenciales.length > 0,
    servicios,
    tiene_servicios: servicios.length > 0,
    propuestas,
    tiene_propuestas: propuestas.length > 0,

    // --- CTA final / footer ---
    cta_titulo: ctaTitulo,
    cta_subtexto: ctaSubtexto,
    tiene_cta_subtexto: Boolean(ctaSubtexto),
    footer_bio: footerBio,
    anio: year,

    // --- contenido demo (§3b) ---
    stats,
    tiene_stats: stats.length > 0,
    nuestro_equipo: nuestroEquipo,
    tiene_nuestro_equipo: nuestroEquipo.length > 0,
    experiencia,
    tiene_experiencia: experiencia.length > 0,
    educacion,
    tiene_educacion: educacion.length > 0,
    investigacion,
    tiene_investigacion: investigacion.length > 0,
    habilidades,
    tiene_habilidades: habilidades.length > 0,
    idiomas,
    tiene_idiomas: idiomas.length > 0,
    mision,
    tiene_mision: Boolean(mision),
    educacion_paciente: educacionPaciente,
    tiene_educacion_paciente: educacionPaciente.length > 0,
    sedacion,
    tiene_sedacion: Boolean(sedacion),
    higiene_puntos: higienePuntos,
    tiene_higiene_puntos: higienePuntos.length > 0,
    cta_urgencia: ctaUrgencia,
    tiene_cta_urgencia: Boolean(ctaUrgencia),
    badge_disponibilidad: badgeDisponibilidad,
    tiene_badge_disponibilidad: Boolean(badgeDisponibilidad),
    calificacion,
    tiene_calificacion: Boolean(calificacion),
    confianza_items: confianzaItems,
    tiene_confianza_items: confianzaItems.length > 0,

    // --- testimonios / faq / derivados del lead ---
    testimonios,
    tiene_testimonios: testimonios.length > 0,
    testimonios_son_ejemplo: Boolean(gc?.sample_fields?.includes(SAMPLE_TESTIMONIALS_KEY)),
    faq,
    tiene_faq: faq.length > 0,
    doctor_cita: doctorCita,
    tiene_doctor_cita: Boolean(doctorCita),
    responsable_tecnico: responsableTecnico,
    tiene_responsable_tecnico: Boolean(responsableTecnico),
    demo_es_ejemplo: demoEsEjemplo,

    // --- tema (patron dc, claves en ingles a proposito, brief §3a) ---
    colors,
    colorsText,
    ...surfaceFlags, // hasBackground / hasSurface

    // --- slots de imagen (§3c) ---
    ...imageSlots,
  };
}

/* ------------------------------------------------------------------ */
/* Pool de plantillas por glob                                         */
/* ------------------------------------------------------------------ */

interface WebPoolEntry {
  /** Nombre de la plantilla sin extension (ej. "doc-clasico"). */
  key: string;
  /** Nombre de archivo dentro de la carpeta del rubro (ej. "doc-clasico.html"). */
  file: string;
}

/**
 * Recorre `src/templates/<folder>/` y devuelve todos los `*.html` que NO
 * empiecen con "_" (prefijo reservado para el visor y archivos auxiliares),
 * en orden alfabetico. El filesystem es el manifest (brief §1): agregar una
 * plantilla = tirar el archivo, sin tocar codigo. Espejo de
 * `listTemplatePool` de build-cards.
 */
async function listWebTemplatePool(folder: string): Promise<WebPoolEntry[]> {
  const dir = fileURLToPath(new URL(`${folder}/`, WEB_TEMPLATES_DIR));
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new Error(
      `build-web: el rubro no tiene carpeta de plantillas web (falta src/templates/${folder}/).`,
    );
  }
  return entries
    .filter((f) => f.endsWith(".html") && !f.startsWith("_"))
    .sort()
    .map((file) => ({ key: file.replace(/\.html$/, ""), file }));
}

/**
 * orderWebPoolByRubro — PURA: mueve al frente la plantilla preferida del rubro
 * (`WEB_TEMPLATE_ORDER`), asi es la primera que ve el cliente en el visor. El
 * resto conserva su orden alfabetico. Si la preferida no esta en el pool o ya
 * esta primera, devuelve el pool sin tocar. Espejo de `orderPoolByRubro`.
 */
export function orderWebPoolByRubro(pool: WebPoolEntry[], rubro: Rubro): WebPoolEntry[] {
  const preferredKey = WEB_TEMPLATE_ORDER[rubro];
  const idx = pool.findIndex((p) => p.key === preferredKey);
  if (idx <= 0) return pool;
  return [pool[idx]!, ...pool.slice(0, idx), ...pool.slice(idx + 1)];
}

/** Etiqueta legible + publico objetivo para el chip del visor (fallback: capitalizado). */
function webLabelFor(key: string): { name: string; audience: string } {
  return WEB_LABELS[key] ?? { name: key.charAt(0).toUpperCase() + key.slice(1), audience: "" };
}

/** Lee una plantilla (o el visor) de la carpeta del rubro bajo src/templates/. */
async function loadTemplateFile(folder: string, file: string): Promise<string> {
  return fs.readFile(fileURLToPath(new URL(`${folder}/${file}`, WEB_TEMPLATES_DIR)), "utf8");
}

/**
 * Lee el manifest del banco de imagenes del rubro. Un rubro sin banco (o sin
 * manifest) devuelve lista vacia: los slots quedan "" y no se copia nada — el
 * build no rompe.
 */
async function loadWebManifest(folder: string): Promise<WebImageManifest> {
  try {
    const raw = await fs.readFile(
      fileURLToPath(new URL(`${folder}/${ASSETS_DIR}/${MANIFEST_FILE}`, WEB_TEMPLATES_DIR)),
      "utf8",
    );
    const parsed = JSON.parse(raw) as WebImageManifest;
    return { images: Array.isArray(parsed.images) ? parsed.images : [] };
  } catch {
    return { images: [] };
  }
}

/* ------------------------------------------------------------------ */
/* Etapa CLI                                                           */
/* ------------------------------------------------------------------ */

/**
 * build-web — etapa CLI. Exige status "enriched" o posterior (guard ANTES de
 * tocar disco). Rellena CADA plantilla del glob del rubro con el MISMO view
 * (`buildWebView`), le inyecta el listener del toggle de marca (el mismo
 * `injectBrandToggle` de build-cards: protocolo dc-brand/dc-brand-ready) y
 * escribe `leads/<slug>/web/<archivo>.html`, mas el visor swipeable en
 * `leads/<slug>/web/index.html` y las imagenes del banco consumidas en
 * `leads/<slug>/web/assets/`. Avanza el status a "web_built" solo si el lead
 * no estaba ya mas adelante (regenerar no retrocede el pipeline). Devuelve la
 * ruta absoluta del visor.
 */
export async function buildWeb(slug: string): Promise<string> {
  if (!slug) throw new Error("build-web: falta el slug. Uso: build-web <slug>");

  const lead = await readLead(slug);
  assertWebBuildableStatus(lead.status);

  const folder = rubroConfig(lead.rubro).webTemplate;
  const pool = await listWebTemplatePool(folder);
  if (pool.length === 0) {
    throw new Error(
      `build-web: src/templates/${folder}/ no tiene ninguna plantilla (*.html sin prefijo _).`,
    );
  }
  const orderedPool = orderWebPoolByRubro(pool, lead.rubro);

  // Imagenes del banco: eleccion determinista por slot; solo se copian las
  // consumidas. `bankDir` es la carpeta real del banco del rubro.
  const manifest = await loadWebManifest(folder);
  const bankDir = fileURLToPath(new URL(`${folder}/${ASSETS_DIR}/`, WEB_TEMPLATES_DIR));
  const images = resolveWebImages(lead, manifest, bankDir);

  // Un solo view object: todo el pool consume el MISMO contrato (brief §3).
  const view = buildWebView(lead, new Date().getFullYear(), images);

  // 1) Cada plantilla del glob -> web/<archivo>, con el toggle de marca inyectado.
  for (const entry of orderedPool) {
    const template = await loadTemplateFile(folder, entry.file);
    const html = injectBrandToggle(renderTemplate(template, view));
    await writeArtifact(slug, path.posix.join(WEB_DIR, entry.file), html);
  }

  // 2) Visor swipeable -> web/index.html. Cada `file` es SOLO el basename: el
  // visor y las paginas viven en la misma carpeta `web/`.
  const viewerTemplate = await loadTemplateFile(folder, VIEWER_TEMPLATE);
  const viewerHtml = renderTemplate(viewerTemplate, {
    pages: orderedPool.map((entry) => {
      const label = webLabelFor(entry.key);
      return { file: entry.file, name: label.name, audience: label.audience };
    }),
  });
  const viewerRelPath = path.posix.join(WEB_DIR, WEB_FILE);
  const viewerPath = await writeArtifact(slug, viewerRelPath, viewerHtml);

  // 3) Imagenes del banco consumidas -> web/assets/ (tolerante a faltantes).
  await copyFilesIntoLead(slug, images.files);

  const order = StatusSchema.options;
  const status: Status =
    order.indexOf(lead.status) < order.indexOf("web_built") ? "web_built" : lead.status;

  await writeLead({
    ...lead,
    status,
    generated: { ...lead.generated, web_url: viewerRelPath },
  });

  return viewerPath;
}

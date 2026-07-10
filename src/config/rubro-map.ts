import type { Rubro } from "../lib/schema.js";

/**
 * rubro-map.ts — mapea cada rubro a su template web, servicios por defecto
 * e ideas base de propuesta.
 * `defaultServices` lo consume `applyExtraction` (`stages/extract.ts`):
 * cuando la tarjeta no enumera servicios, cae a esta lista fija en vez de
 * dejar `content.services` vacio (queda anotado en meta.needs para que
 * `verify` lo confirme). El template por rubro es para la etapa build-web
 * (stub por ahora). Las digital cards (build-cards) NO se filtran por rubro:
 * cada lead recibe TODOS los disenos del pool en `src/dc-templates/`, para
 * que el cliente elija cual le gusta mas.
 */

export interface RubroConfig {
  webTemplate: string; // carpeta bajo src/templates/
  defaultServices: string[];
  // defaultHours: horario tipico por rubro. La tarjeta casi nunca lo trae; la
  // etapa `enrich` lo usa como fallback DETERMINISTA para `contact.hours` cuando
  // falta (NO lo inventa el LLM, mismo criterio que defaultServices) y lo anota
  // en meta.needs para que el humano lo confirme/ajuste.
  defaultHours: string;
  proposalIdeas: string[];
}

const CONFIG: Record<Rubro, RubroConfig> = {
  doctor: {
    webTemplate: "doctor",
    defaultServices: ["Consulta", "Estudios", "Seguimiento"],
    defaultHours: "Lunes a Viernes 9:00-18:00, Sabado 9:00-14:00",
    proposalIdeas: ["Agenda de citas online", "Recordatorios por WhatsApp"],
  },
  barberia: {
    webTemplate: "barberia",
    defaultServices: ["Corte", "Barba", "Afeitado"],
    defaultHours: "Martes a Sabado 10:00-20:00",
    proposalIdeas: ["Reserva de turnos", "Programa de fidelidad"],
  },
  estetica: {
    webTemplate: "estetica",
    defaultServices: ["Facial", "Manicura", "Depilacion"],
    defaultHours: "Lunes a Sabado 10:00-19:00",
    proposalIdeas: ["Catalogo de servicios", "Reserva online"],
  },
  veterinario: {
    webTemplate: "generico",
    defaultServices: ["Consulta", "Vacunacion", "Urgencias"],
    defaultHours: "Lunes a Sabado 9:00-19:00, Urgencias 24h",
    proposalIdeas: ["Carnet digital de mascotas", "Recordatorio de vacunas"],
  },
  nutriologo: {
    webTemplate: "generico",
    defaultServices: ["Plan alimenticio", "Seguimiento", "Consulta"],
    defaultHours: "Lunes a Viernes 9:00-18:00",
    proposalIdeas: ["Portal de planes", "Seguimiento por WhatsApp"],
  },
  otro: {
    webTemplate: "generico",
    defaultServices: [],
    defaultHours: "Lunes a Viernes 9:00-18:00",
    proposalIdeas: ["Presencia web basica", "Contacto directo por WhatsApp"],
  },
};

export function rubroConfig(rubro: Rubro): RubroConfig {
  return CONFIG[rubro];
}

/**
 * CARD_LABELS — etiqueta legible + publico objetivo de cada diseno del pool,
 * para el chip del visor swipeable (`src/dc-templates/_viewer.html`). La
 * clave es el nombre de archivo del template sin extension (ej. "clinic.html"
 * -> "clinic"). Un diseno nuevo sin entrada aca cae al fallback en
 * `labelFor()` (nombre de archivo capitalizado, sin publico objetivo).
 */
export const CARD_LABELS: Record<string, { name: string; audience: string }> = {
  clinic: { name: "Clinic", audience: "Salud · Médicos" },
  dark: { name: "Dark", audience: "Barberías · Tattoo · Gym" },
  executive: { name: "Executive", audience: "Abogados · Consultores" },
  luxury: { name: "Luxury", audience: "Hoteles · Inmobiliarias" },
  credencial: { name: "Credencial", audience: "General" },
  // Pool decorativo (motivos intercambiables por rubro, avatar circular).
  celeste: { name: "Celeste", audience: "Salud y consultorios" },
  vitrina: { name: "Vitrina", audience: "Nutrición y bienestar" },
  rotulo: { name: "Rótulo", audience: "Barberías y oficios" },
  seda: { name: "Seda", audience: "Estética y belleza" },
  redondo: { name: "Redondo", audience: "Veterinarias y cercanía" },
  lienzo: { name: "Lienzo", audience: "General (default)" },
  // Guelaguetza (Oaxaca): paleta y arte FIJOS para todos los rubros; solo
  // cambian los datos y la capa de motivos. Imagenes propias en dc/assets/.
  "guelaguetza-calenda": { name: "Calenda", audience: "Guelaguetza · Oaxaca" },
  "guelaguetza-pina": { name: "Flor de Piña", audience: "Guelaguetza · Oaxaca" },
  "guelaguetza-tehuana": { name: "Tehuana", audience: "Guelaguetza · Oaxaca" },
};

/**
 * RUBRO_TEMPLATE_ORDER — que diseno del pool abre PRIMERO en el visor
 * swipeable segun el rubro del lead (el resto sigue en su orden habitual;
 * el carrusel es un bucle infinito, asi que "primero" solo define el punto
 * de entrada). La clave del valor debe matchear el nombre de archivo del
 * template sin extension en `src/dc-templates/`. Si el diseno referenciado
 * no esta en el pool (se borro el archivo), `orderPoolByRubro`
 * (`build-cards.ts`) cae al orden original sin romper.
 */
export const RUBRO_TEMPLATE_ORDER: Record<Rubro, string> = {
  doctor: "clinic",
  veterinario: "clinic",
  nutriologo: "clinic",
  barberia: "dark",
  estetica: "luxury",
  otro: "credencial",
};

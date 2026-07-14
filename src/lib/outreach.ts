import type { Lead } from "./schema.js";

/**
 * outreach.ts — arma el MENSAJE de contacto en frio (listo para copiar/pegar a
 * WhatsApp) a partir de un lead que ya tiene sus digital cards generadas. Es la
 * pieza PURA (sin I/O) que consume el stage `package`.
 *
 * Principio rector del repo: lo determinista va en codigo, lo interpretativo al
 * LLM. El copy de venta es una PLANTILLA fija con huecos (nombre del negocio,
 * enlaces), no interpretacion de una foto — asi que se arma con templating puro,
 * es 100% testeable y no depende del LLM.
 *
 * El mensaje viene en DOS partes (el "front" y el "back" del pedido):
 *  - apertura (front): saludo personalizado + contexto honesto ("estuve en su
 *    negocio y tome una foto de su tarjeta") + los enlaces ya generados.
 *    Mostrar valor ENTREGADO (no una promesa) baja la friccion del primer
 *    contacto: es marketing de "muestra gratis". Cierra ofreciendo
 *    personalizacion, sin pedir cita ni presionar.
 *  - seguimiento (back): la explicacion tecnologica. La tarjeta es la muestra;
 *    el menu lista que mas se automatiza. La prueba de que si lo hacemos es que
 *    esta misma tarjeta se genero sola desde una fotografia — el propio
 *    entregable ES la prueba social.
 */

/**
 * PUBLIC_BASE_URL — dominio publico donde se sirve cada lead. `deploy` publica
 * la tarjeta en `<base>/<slug>/dc/` y la web en `<base>/<slug>/web/` (ver
 * `publicUrl` en src/stages/deploy.ts); estas URLs replican ESA estructura.
 */
export const PUBLIC_BASE_URL = "https://cards.kronet.app";

/**
 * URL publica de la tarjeta digital (visor swipeable). OJO: lleva el sufijo
 * `/dc/` — el raiz `<base>/<slug>` NO resuelve, ahi solo viven las carpetas
 * dc/ y web/ que sube deploy.
 */
export function publicCardUrl(slug: string): string {
  return `${PUBLIC_BASE_URL}/${slug}/dc/`;
}

/** URL publica de la pagina web generada (visor swipeable de build-web). */
export function publicWebUrl(slug: string): string {
  return `${PUBLIC_BASE_URL}/${slug}/web/`;
}

/**
 * Nombre para el saludo: preferimos a la PERSONA (trato directo con el dueno),
 * caemos al nombre del negocio y, si no hay nada, dejamos el placeholder
 * "[nombre]" para que el vendedor lo complete a mano antes de enviar.
 */
export function greetingName(lead: Lead): string {
  return lead.business.person_name?.trim() || lead.business.name?.trim() || "[nombre]";
}

/**
 * UPSELL_SYSTEMS — menu de automatizaciones del mensaje de seguimiento. Frases
 * cortas en lenguaje del cliente (que gana), sin jerga tecnica ni negritas:
 * en WhatsApp una lista simple se lee mejor que un catalogo con pitch largo.
 * Agregar/quitar una oferta = editar esta lista, sin tocar la logica.
 */
export const UPSELL_SYSTEMS: string[] = [
  "Agenda de citas en línea.",
  "WhatsApp que responde y agenda automáticamente.",
  "Seguimiento de clientes y recordatorios.",
  "Sistemas administrativos.",
  "Sitios web y presencia digital.",
];

/**
 * OutreachMessage — el mensaje armado en sus dos partes mas la version completa
 * (ambas juntas) que se persiste en `generated.outreach_message`.
 */
export interface OutreachMessage {
  /** Mensaje de apertura: saludo + contexto + enlaces. */
  front: string;
  /** Mensaje de seguimiento: explicacion tecnologica + menu de sistemas. */
  back: string;
  /** front + back, separados, listo para guardar/enviar. */
  full: string;
}

/** Separador visual entre las dos partes del mensaje completo. */
const PART_SEPARATOR = "———";

/**
 * buildOutreachMessage — PURA: Lead -> mensaje de contacto en frio. No toca
 * disco ni status. Ambos enlaces se derivan del slug (dominio publico + la
 * estructura /dc/ y /web/ que sube deploy) — `generated.web_url` puede traer
 * una ruta RELATIVA antes del deploy ("web/index.html"), asi que solo se usa
 * como SENAL de que la web existe, nunca como URL del mensaje. La linea de la
 * pagina web solo se incluye si esa senal esta presente.
 */
export function buildOutreachMessage(lead: Lead): OutreachMessage {
  const nombre = greetingName(lead);
  const negocio = lead.business.name?.trim() || "su negocio";
  const hasWeb = Boolean(lead.generated.web_url?.trim());

  const enlaces = [`📱 Tarjeta digital:`, publicCardUrl(lead.slug)];
  if (hasWeb) enlaces.push(``, `🌐 Página web:`, publicWebUrl(lead.slug));

  const front = [
    `Hola, buen día ${nombre}. 👋`,
    ``,
    `Estuve en ${negocio} y tomé una foto de su tarjeta de presentación. Como parte de una demostración, la convertí en una tarjeta digital interactiva.`,
    ``,
    `Ya está lista y puede verla aquí:`,
    ``,
    ...enlaces,
    ``,
    `Incluye varios diseños para que pueda comparar distintas opciones y ver cómo podría presentarse su negocio de forma profesional desde un solo enlace.`,
    ``,
    `Si le gusta la idea, con gusto puedo personalizarla con la información o los cambios que desee.`,
  ].join("\n");

  const menu = UPSELL_SYSTEMS.map((s) => `• ${s}`).join("\n");

  const back = [
    `La tarjeta digital es solo una pequeña muestra de lo que hacemos.`,
    ``,
    `Ayudamos a negocios a automatizar procesos para ahorrar tiempo y mejorar la atención a sus clientes, por ejemplo:`,
    ``,
    menu,
    ``,
    `De hecho, esta misma tarjeta se creó automáticamente a partir de una fotografía. Esa misma automatización es la que aplicamos en otros procesos del negocio.`,
    ``,
    `Si en algún momento le interesa conocer cómo podría aprovechar estas herramientas en ${negocio}, con gusto le muestro algunas ideas, sin compromiso.`,
  ].join("\n");

  const full = `${front}\n\n${PART_SEPARATOR}\n\n${back}`;
  return { front, back, full };
}

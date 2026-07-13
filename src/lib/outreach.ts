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
 *  - apertura (front): saludo personalizado + gancho + los enlaces de la
 *    tarjeta/web que YA le generamos. Mostrar valor ENTREGADO (no una promesa)
 *    baja la friccion del primer contacto: es marketing de "muestra gratis".
 *  - seguimiento (back): un menu de otros sistemas que automatizamos, por si la
 *    tarjeta no es lo que buscaba (manejo de objecion / up-sell). La prueba de
 *    que si los hacemos es que esta misma tarjeta y su web se generaron solas
 *    desde una foto — el propio entregable ES la prueba social.
 */

/**
 * PUBLIC_BASE_URL — dominio publico donde se sirve cada digital card. La URL
 * final de un lead es `${PUBLIC_BASE_URL}/<slug>`. Cuando exista el deploy real
 * (hoy `deploy` es stub) ese subpath es el que quedara publicado; el mensaje ya
 * apunta ahi para no tener que regenerarlo despues.
 */
export const PUBLIC_BASE_URL = "https://cards.kronet.app";

/** URL publica de la tarjeta digital de un lead (visor swipeable). */
export function publicCardUrl(slug: string): string {
  return `${PUBLIC_BASE_URL}/${slug}`;
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
 * UpsellSystem — un item del menu de sistemas que se ofrecen en el "back". El
 * `pitch` es el beneficio en lenguaje del cliente (que gana), no la feature.
 */
export interface UpsellSystem {
  emoji: string;
  name: string;
  pitch: string;
}

/**
 * UPSELL_SYSTEMS — catalogo fijo de automatizaciones que se ofrecen si la
 * tarjeta no le interesa al cliente. Es dato determinista (catalogo en codigo),
 * mismo criterio que `rubroConfig().defaultServices`. Agregar/quitar una oferta
 * = editar esta lista, sin tocar la logica del mensaje.
 */
export const UPSELL_SYSTEMS: UpsellSystem[] = [
  {
    emoji: "📅",
    name: "Agenda de citas automatizada",
    pitch: "sus clientes reservan solos, sin llamadas ni idas y vueltas.",
  },
  {
    emoji: "🤖",
    name: "Bot de WhatsApp que atiende 24/7",
    pitch: "responde dudas y agenda aunque usted esté ocupado o ya haya cerrado.",
  },
  {
    emoji: "👥",
    name: "Sistema de seguimiento de clientes (CRM)",
    pitch: "recordatorios y mensajes automáticos para que vuelvan y no se enfríen.",
  },
  {
    emoji: "📊",
    name: "Sistema contable",
    pitch: "ventas, gastos y cortes de caja ordenados, sin hojas de cálculo sueltas.",
  },
  {
    emoji: "📣",
    name: "Automatización de anuncios en redes sociales",
    pitch: "publica y promociona su negocio de forma automática, todos los días.",
  },
];

/**
 * OutreachMessage — el mensaje armado en sus dos partes mas la version completa
 * (ambas juntas) que se persiste en `generated.outreach_message`.
 */
export interface OutreachMessage {
  /** Mensaje de apertura: saludo + gancho + enlaces. */
  front: string;
  /** Mensaje de seguimiento: menu de otros sistemas (up-sell). */
  back: string;
  /** front + back, separados, listo para guardar/enviar. */
  full: string;
}

/** Separador visual entre las dos partes del mensaje completo. */
const PART_SEPARATOR = "———";

/**
 * buildOutreachMessage — PURA: Lead -> mensaje de contacto en frio. No toca
 * disco ni status. Los enlaces salen del dominio publico + el slug (la tarjeta
 * siempre existe cuando corre `package`); el sitio web solo se incluye si el
 * lead ya trae `generated.web_url` (hoy `build-web` es stub, asi que casi
 * siempre solo va la tarjeta).
 */
export function buildOutreachMessage(lead: Lead): OutreachMessage {
  const nombre = greetingName(lead);
  const negocio = lead.business.name?.trim() || "su negocio";
  const cardUrl = publicCardUrl(lead.slug);
  const webUrl = lead.generated.web_url?.trim();

  const enlaces = [`🔗 Tarjeta digital: ${cardUrl}`];
  if (webUrl) enlaces.push(`🌐 Sitio web: ${webUrl}`);

  const front = [
    `Hola, buen día ${nombre} 👋`,
    ``,
    `Le escribo de Kronet. Tomé la tarjeta de ${negocio} y me di a la tarea de convertirla en una *tarjeta digital*: se abre desde el celular, se comparte con un solo enlace, guarda su contacto con un toque y está disponible las 24 horas.`,
    ``,
    `Ya se la dejé lista, aquí puede verla:`,
    ...enlaces,
    ``,
    `Vienen varios diseños para que elija el que más le guste; si alguno le convence, se lo publicamos con sus datos. ¿Le parece si lo revisamos juntos?`,
  ].join("\n");

  const menu = UPSELL_SYSTEMS.map((s) => `• ${s.emoji} *${s.name}* — ${s.pitch}`).join("\n");

  const back = [
    `Y si la tarjeta no es justo lo que buscaba, es apenas una muestra. También creamos sistemas que le ahorran tiempo y le traen más clientes:`,
    ``,
    menu,
    ``,
    `La mejor prueba de que sí lo hacemos: esta tarjeta digital (y su versión web) se generaron *de forma automática* a partir de una sola foto de su tarjeta. Dígame qué le serviría a ${negocio} y se lo preparo, sin compromiso.`,
  ].join("\n");

  const full = `${front}\n\n${PART_SEPARATOR}\n\n${back}`;
  return { front, back, full };
}

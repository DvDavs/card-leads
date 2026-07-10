import { z } from "zod";

/**
 * schema.ts — LA fuente de verdad del tipo `Lead`.
 * El tipo TS se INFIERE del schema Zod (no se declara a mano),
 * asi la validacion en runtime y el tipo en compile-time no pueden divergir.
 */

export const RubroSchema = z.enum([
  "doctor",
  "barberia",
  "estetica",
  "veterinario",
  "nutriologo",
  "otro",
]);
export type Rubro = z.infer<typeof RubroSchema>;

export const StatusSchema = z.enum([
  "ingested", // fotos guardadas, nada extraido
  "extracted", // LLM lleno datos, ESPERA revision humana
  "verified", // el humano dio OK a los datos
  "linktree_built",
  "enriched", // copy de marketing generado por IA (web-ready), ESPERA build-web
  "web_built",
  "deployed",
  "proposal_ready", // propuesta generada, ESPERA OK
  "packaged", // mensaje listo para copiar/pegar
  "error",
]);
export type Status = z.infer<typeof StatusSchema>;

export const ChannelSchema = z.enum(["telegram", "manual"]);
export type Channel = z.infer<typeof ChannelSchema>;

/**
 * migrateContact — MIGRACION en carga: los data.json viejos guardaban un solo
 * `contact.phone` (string). Ahora un consultorio puede tener varios telefonos,
 * asi que el campo es `contact.phones` (string[]). Este preprocess convierte el
 * legacy `phone` en `phones` ANTES de validar, para que ningun lead existente
 * reviente al leerse. Es idempotente: si ya hay `phones`, no toca nada.
 *
 * Ademas SEPARA por coma: en pruebas reales el modelo viejo metio varios numeros
 * en un solo string ("num1, num2, num3"), lo que romperia los botones tel:/wa.me.
 * Un numero de telefono no lleva comas legitimas, asi que dividir por coma es
 * seguro y deja la lista limpia sin intervencion humana.
 */
function migrateContact(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const c = raw as Record<string, unknown>;
  if (c.phones !== undefined || c.phone === undefined) return raw;
  const { phone, ...rest } = c;
  const phones =
    typeof phone === "string" ? phone.split(",").map((p) => p.trim()).filter(Boolean) : [];
  return phones.length ? { ...rest, phones } : rest;
}

export const ContactSchema = z.preprocess(
  migrateContact,
  z.object({
    // varios telefonos: un consultorio puede listar mas de uno (llamada / wa.me
    // se arman por cada numero en build-cards).
    phones: z.array(z.string()).optional(),
    whatsapp: z.string().optional(), // WhatsApp es UNO solo; normalizado a E.164 si se puede
    email: z.string().optional(),
    address: z.string().optional(),
    website: z.string().optional(),
    // hours: horario de atencion. NO viene en la tarjeta casi nunca; la etapa
    // `enrich` lo rellena con el default DETERMINISTA por rubro
    // (rubroConfig.defaultHours) cuando falta y lo anota en meta.needs para que
    // el humano lo confirme. No lo inventa el LLM (mismo principio que
    // defaultServices). Opcional => data.json viejos siguen validando.
    hours: z.string().optional(),
  }),
);

/**
 * GeneratedCopySchema — el bloque de copy de MARKETING que produce la etapa
 * `enrich`. Todo es texto GENERADO por el LLM a partir de los datos YA
 * verificados (no medido, no leido de la tarjeta): headlines, bio, value props,
 * FAQs, testimonios de ejemplo, CTA. Vive SEPARADO de los datos reales
 * (`business`/`contact`/`socials`/`brand`) a proposito, para que sea obvio que
 * es generado y para que a futuro `verify` pueda mostrarlo/editarlo. Se genera
 * UNA vez y se persiste; `build-web` lee de aca, no regenera (mismo lead, misma
 * web, sin costo ni no-determinismo). El LLM NUNCA aporta datos de contacto,
 * numeros duros (stats) ni credenciales: solo prosa.
 */
export const GeneratedCopySchema = z.object({
  hero_headline: z.string(), // H1, frase corta de marketing
  hero_subheadline: z.string(), // pitch bajo el H1, 1-2 frases
  hero_badge: z.string().optional(), // pill corta ("Aceptando pacientes")
  bio: z.string(), // 1 parrafo sobre el profesional/negocio
  pull_quote: z.string().optional(), // cita en 1ra persona, 1 frase
  // value_props: reemplazan a los "stats" (numeros inventados, se descartaron a
  // proposito): claims CUALITATIVOS, no cuantitativos.
  value_props: z.array(z.object({ title: z.string(), description: z.string() })),
  // service_descriptions: una descripcion por servicio REAL. El nombre debe
  // matchear un servicio de `content.services` (autoridad = verify); la etapa
  // descarta cualquier descripcion cuyo nombre no exista. El LLM NO cambia la
  // lista de servicios, solo le pega texto.
  service_descriptions: z.array(z.object({ name: z.string(), description: z.string() })),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
  // testimonials: reseñas de EJEMPLO (autor generico). Fabricadas: se registran
  // en `sample_fields` para que verify las marque como ejemplo editable.
  testimonials: z.array(
    z.object({ quote: z.string(), author: z.string(), role: z.string().optional() }),
  ),
  cta_headline: z.string(),
  cta_subtext: z.string(),
  footer_tagline: z.string(),
  meta_title: z.string().optional(), // <title> para SEO
  meta_description: z.string().optional(),
  generated_at: z.string(), // ISO — cuando se genero el copy
  // sample_fields: nombres de campos cuyo contenido es EJEMPLO/placeholder (hoy
  // "testimonials"), no dato real. Para que verify/publicacion los marquen.
  sample_fields: z.array(z.string()).optional(),
});
export type GeneratedCopy = z.infer<typeof GeneratedCopySchema>;

export const LeadSchema = z.object({
  slug: z.string().min(1), // llave. ej "dr-perez-cardiologo"
  status: StatusSchema,
  rubro: RubroSchema,

  source: z.object({
    card_front: z.string(), // ruta relativa dentro de la carpeta del lead
    card_back: z.string().optional(),
    ingested_at: z.string(), // ISO
    channel: ChannelSchema,
  }),

  business: z.object({
    // string (no .min(1)) a proposito: al ingerir aun no hay nombre,
    // se rellena en `extract` y el hueco queda anotado en meta.needs.
    name: z.string(),
    person_name: z.string().optional(),
    tagline: z.string().optional(),
    attrs: z.record(z.string()), // atributos libres por rubro
  }),

  contact: ContactSchema,

  socials: z.object({
    facebook: z.string().optional(),
    instagram: z.string().optional(),
    tiktok: z.string().optional(),
    other: z.record(z.string()).optional(),
  }),

  brand: z.object({
    // palette: TODOS los hex de marca MEDIDOS de los pixeles con colorthief (ver
    // lib/colors). Es la lista cruda de candidatos; se le pasa al LLM para que
    // asigne roles eligiendo de aca (nunca inventa un hex fuera de la lista).
    // Opcional => data.json viejos (sin esta clave) siguen validando.
    palette: z.array(z.string()).optional(),
    // colors: hex por ROL. `primary/secondary/accent` los consumen las digital
    // cards; `background/surface/text` los asigna el LLM para el fondo, la
    // superficie y la tinta de la tarjeta (aun no los usan los templates). El hex
    // sale de `palette` (medido); la ASIGNACION la hace el LLM con vision. Todos
    // editables a mano en verify (el humano confirma o corrige).
    colors: z.object({
      primary: z.string().optional(),
      secondary: z.string().optional(),
      accent: z.string().optional(),
      background: z.string().optional(),
      surface: z.string().optional(),
      text: z.string().optional(),
    }),
    // colorsText: color de texto legible (#fff/#000) DERIVADO de cada hex de
    // `colors` que sea SUPERFICIE (WCAG). Mapa paralelo, no editable a mano: se
    // recalcula del hex. Lo consumen las cards para pintar texto legible sobre
    // cada color. `text` no lleva colorsText (es tinta, no superficie). Opcional
    // => los data.json viejos (sin esta clave) siguen validando; extract y verify
    // siempre lo escriben, asi que downstream lo ve completo.
    colorsText: z
      .object({
        primary: z.string().optional(),
        secondary: z.string().optional(),
        accent: z.string().optional(),
        background: z.string().optional(),
        surface: z.string().optional(),
      })
      .optional(),
    has_logo: z.boolean(),
    logo_path: z.string().optional(),
    // photo_path: foto real para el avatar circular (retrato del profesional o
    // imagen del negocio). Ruta local dentro de leads/<slug>/ o data URI. Tiene
    // PRIORIDAD sobre logo_path en la cascada del avatar (photo -> logo ->
    // inicial). Opcional: si falta, cada card cae al logo o a la inicial. NUNCA
    // una cara/foto generada — solo material real que aporta el negocio.
    photo_path: z.string().optional(),
    font_hint: z.string().optional(), // "serif"/"sans"/"display" — pista, no exacto
  }),

  content: z.object({
    services: z.array(z.string()),
    about: z.string().optional(),
    highlights: z.array(z.string()).optional(),
    // generated_copy: copy de marketing generado por la etapa `enrich`. Ver
    // GeneratedCopySchema. Opcional => data.json previos a enrich siguen
    // validando (back-compat, no hace falta migracion).
    generated_copy: GeneratedCopySchema.optional(),
  }),

  generated: z.object({
    linktree_url: z.string().optional(), // legacy: un solo diseno (pre digital-cards)
    dc_url: z.string().optional(), // "dc/index.html" — el visor swipeable
    // una entrada por diseno rellenado en leads/<slug>/dc/
    cards: z
      .array(
        z.object({
          template: z.string(), // "clinic" | "dark" | "executive" | "luxury" | "credencial"
          path: z.string(), // "dc/clinic.html"
        }),
      )
      .optional(),
    web_url: z.string().optional(),
    proposal_path: z.string().optional(),
    outreach_message: z.string().optional(),
  }),

  meta: z.object({
    needs: z.array(z.string()), // que le falta para avanzar (human-in-loop)
    errors: z.array(z.string()),
    updated_at: z.string(),
  }),
});

/** El tipo Lead se deriva del schema. Editá el schema, no el tipo. */
export type Lead = z.infer<typeof LeadSchema>;

/** Valida y parsea datos crudos (p.ej. desde data.json). Lanza si no cumple. */
export function parseLead(data: unknown): Lead {
  return LeadSchema.parse(data);
}

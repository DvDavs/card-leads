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
  }),
);

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
    // colors: hex de marca MEDIDOS de los pixeles con colorthief (ver lib/colors).
    // Siguen siendo editables a mano en verify (el humano confirma o corrige).
    colors: z.object({
      primary: z.string().optional(),
      secondary: z.string().optional(),
      accent: z.string().optional(),
    }),
    // colorsText: color de texto legible (#fff/#000) DERIVADO de cada hex de
    // `colors` (WCAG). Mapa paralelo, no editable a mano: se recalcula del hex.
    // Lo consume el linktree para pintar texto legible sobre cada color de marca.
    // Opcional => los data.json viejos (sin esta clave) siguen validando; extract
    // y verify siempre lo escriben, asi que downstream (linktree) lo ve completo.
    colorsText: z
      .object({
        primary: z.string().optional(),
        secondary: z.string().optional(),
        accent: z.string().optional(),
      })
      .optional(),
    has_logo: z.boolean(),
    logo_path: z.string().optional(),
    font_hint: z.string().optional(), // "serif"/"sans"/"display" — pista, no exacto
  }),

  content: z.object({
    services: z.array(z.string()),
    about: z.string().optional(),
    highlights: z.array(z.string()).optional(),
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

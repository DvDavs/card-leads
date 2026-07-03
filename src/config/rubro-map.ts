import type { Rubro } from "../lib/schema.js";

/**
 * rubro-map.ts — mapea cada rubro a su template web, servicios por defecto
 * (para inferir cuando la tarjeta no los trae) e ideas base de propuesta.
 * El linktree usa siempre el template "generico"; el template por rubro es
 * para la etapa build-web (stub por ahora).
 */

export interface RubroConfig {
  webTemplate: string; // carpeta bajo src/templates/
  defaultServices: string[];
  proposalIdeas: string[];
}

const CONFIG: Record<Rubro, RubroConfig> = {
  doctor: {
    webTemplate: "doctor",
    defaultServices: ["Consulta", "Estudios", "Seguimiento"],
    proposalIdeas: ["Agenda de citas online", "Recordatorios por WhatsApp"],
  },
  barberia: {
    webTemplate: "barberia",
    defaultServices: ["Corte", "Barba", "Afeitado"],
    proposalIdeas: ["Reserva de turnos", "Programa de fidelidad"],
  },
  estetica: {
    webTemplate: "estetica",
    defaultServices: ["Facial", "Manicura", "Depilacion"],
    proposalIdeas: ["Catalogo de servicios", "Reserva online"],
  },
  veterinario: {
    webTemplate: "generico",
    defaultServices: ["Consulta", "Vacunacion", "Urgencias"],
    proposalIdeas: ["Carnet digital de mascotas", "Recordatorio de vacunas"],
  },
  nutriologo: {
    webTemplate: "generico",
    defaultServices: ["Plan alimenticio", "Seguimiento", "Consulta"],
    proposalIdeas: ["Portal de planes", "Seguimiento por WhatsApp"],
  },
  otro: {
    webTemplate: "generico",
    defaultServices: [],
    proposalIdeas: ["Presencia web basica", "Contacto directo por WhatsApp"],
  },
};

export function rubroConfig(rubro: Rubro): RubroConfig {
  return CONFIG[rubro];
}

/** Template a usar para el linktree. Por ahora siempre generico. */
export function linktreeTemplate(): string {
  return "generico";
}

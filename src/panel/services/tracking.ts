import { parseLead, type Lead, type SendState, type Tracking } from "../../lib/schema.js";
import { readLead, writeLead } from "../../lib/storage.js";
import { withSlugLock } from "./pipeline.js";

/**
 * tracking.ts — control de ORGANIZACIÓN y ENVÍO de la tarjeta (carpeta + estado
 * + quién creó/envió). La lógica de mutación (`applyTracking`) es PURA y
 * testeable; esta capa solo hace el load -> transform -> re-validate -> persist
 * bajo el lock del slug, igual que corrections.ts.
 */

/**
 * DEFAULT_FOLDERS — carpetas sugeridas de arranque para el panel. NO es una
 * lista cerrada: el operador puede escribir una carpeta nueva al mover una
 * tarjeta (folder es texto libre). Se usa solo para poblar los chips/atajos de
 * la UI cuando todavía no hay tarjetas en esa carpeta.
 */
export const DEFAULT_FOLDERS = ["David", "Juan", "Borradores"] as const;

export class TrackingError extends Error {}

export interface TrackingPatch {
  /** null/"" limpia la carpeta; un string la asigna. undefined = no tocar. */
  folder?: string | null;
  /** nuevo estado de envío. undefined = no tocar. */
  send_state?: SendState;
  /** quién creó (corrección manual). undefined = no tocar; null/"" limpia. */
  created_by?: string | null;
  /** quién envió (override manual). undefined = no tocar; null/"" limpia. */
  sent_by?: string | null;
  /**
   * operador que ejecuta la acción. Al pasar send_state="sent" se estampa como
   * sent_by (salvo que venga un sent_by explícito) junto con sent_at.
   */
  actor?: string;
}

/** util: string sin vacío tras trim, o undefined. */
function norm(s: string | null | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

/**
 * applyTracking — función PURA: aplica un patch de tracking a UN lead. Nunca
 * muta el lead de entrada ni toca disco. Reglas:
 *  - folder/created_by/sent_by: se setean o se limpian (null/"" => undefined).
 *  - send_state: se setea. Si pasa a "sent", estampa sent_at=nowIso y
 *    sent_by = (sent_by explícito ?? actor), a menos que ya se pase sent_by.
 *    Cambiar a otro estado NO borra sent_by/sent_at (queda el historial).
 */
export function applyTracking(lead: Lead, patch: TrackingPatch, nowIso: string): Lead {
  // tracking puede faltar en data.json viejos: se arranca de un default "draft".
  const t: Tracking = { send_state: "draft", ...lead.tracking };

  if (patch.folder !== undefined) t.folder = norm(patch.folder);
  if (patch.created_by !== undefined) t.created_by = norm(patch.created_by);
  if (patch.sent_by !== undefined) t.sent_by = norm(patch.sent_by);

  if (patch.send_state !== undefined) {
    t.send_state = patch.send_state;
    if (patch.send_state === "sent") {
      t.sent_at = nowIso;
      // sent_by explícito gana; si no, se estampa el operador que hizo la acción.
      if (patch.sent_by === undefined && norm(patch.actor)) t.sent_by = norm(patch.actor);
    }
  }

  return { ...lead, tracking: t };
}

/** Carga el lead, aplica el patch de tracking, re-valida y persiste. Serializado por slug. */
export async function updateTracking(slug: string, patch: TrackingPatch): Promise<Lead> {
  return withSlugLock(slug, async () => {
    const lead = await readLead(slug);
    const next = applyTracking(lead, patch, new Date().toISOString());
    let validated: Lead;
    try {
      validated = parseLead(next);
    } catch (err) {
      throw new TrackingError(err instanceof Error ? err.message : String(err));
    }
    await writeLead(validated);
    return validated;
  });
}

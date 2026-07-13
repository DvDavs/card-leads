import { StatusSchema, type Lead, type Status } from "../lib/schema.js";
import { buildOutreachMessage, type OutreachMessage } from "../lib/outreach.js";
import { readLead, writeLead } from "../lib/storage.js";

/**
 * package — arma el MENSAJE de contacto listo para copiar/pegar a WhatsApp
 * (saludo + gancho + enlaces de la tarjeta ya generada + menu de otros
 * sistemas), lo guarda en `generated.outreach_message` y deja el lead en status
 * "packaged". El copy vive en `lib/outreach.ts` (pieza pura, testeable); aca
 * solo esta la orquestacion de I/O (leer, guard de status, escribir).
 */

export interface PackageResult {
  lead: Lead;
  message: OutreachMessage;
}

/**
 * assertPackageableStatus — el mensaje incluye los enlaces de la tarjeta ya
 * generada, asi que exige que `build-cards` ya haya corrido: status
 * "linktree_built" (el que deja build-cards) o posterior, excluyendo "error".
 * Mismo criterio que `assertBuildableStatus` (orden por indice en StatusSchema),
 * para no retroceder si el lead ya venia mas adelante.
 *
 * NOTA: no se exige `web_built` a proposito — `build-web` es stub y ningun lead
 * puede alcanzar ese status por el pipeline. El mensaje incluye el enlace web
 * solo si el lead ya trae `generated.web_url`.
 */
export function assertPackageableStatus(status: Status): void {
  const order = StatusSchema.options;
  const ok = status !== "error" && order.indexOf(status) >= order.indexOf("linktree_built");
  if (ok) return;
  throw new Error(
    `package: el lead esta en status "${status}" y se requiere "linktree_built" o posterior. ` +
      `Corre 'build-cards <slug>' primero para generar la tarjeta digital.`,
  );
}

/**
 * pkg — etapa CLI. Lee el lead, valida el status (guard ANTES de tocar disco),
 * arma el mensaje de outreach, lo persiste en `generated.outreach_message` y
 * avanza el status a "packaged" (sin retroceder si ya estaba mas adelante).
 * Devuelve el lead actualizado y el mensaje (front/back/full) para que el CLI
 * lo imprima.
 */
export async function pkg(slug: string): Promise<PackageResult> {
  if (!slug) throw new Error("package: falta el slug. Uso: package <slug>");

  const lead = await readLead(slug);
  assertPackageableStatus(lead.status);

  const message = buildOutreachMessage(lead);

  const order = StatusSchema.options;
  const status: Status =
    order.indexOf(lead.status) < order.indexOf("packaged") ? "packaged" : lead.status;

  const updated: Lead = {
    ...lead,
    status,
    generated: { ...lead.generated, outreach_message: message.full },
  };
  await writeLead(updated);

  return { lead: updated, message };
}

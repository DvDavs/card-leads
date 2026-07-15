import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv } from "../lib/env.js";
import { StatusSchema, type Lead, type Status } from "../lib/schema.js";
import { isValidSlug } from "../lib/slug.js";
import { leadDir, readLead, writeLead } from "../lib/storage.js";
import { runCommand } from "../lib/ssh.js";
import {
  posixQuote,
  remoteLeadDir,
  resolveDeployConfig,
  sshBaseArgs,
  type PanelEntry,
} from "./deploy.js";

/**
 * undeploy — lo inverso de `deploy`: borra `<root>/<slug>` en el droplet (dc/ +
 * web/ publicados) y saca el lead del manifest del panel, dejando el link
 * publico en 404. NO toca la carpeta local del lead (`leads/<slug>/`): los
 * artefactos siguen en disco para poder re-publicar. Solo limpia de `generated`
 * lo que apuntaba al server (URLs + mensaje de contacto, que embebia esas URLs
 * ya muertas) y regresa el status al ultimo estado "construido pero sin
 * publicar". Para borrar TODO el lead (datos + fotos) esta `deleteLead`, que es
 * local; esto es solo la despublicacion remota.
 */

/**
 * removeFromPanelManifest — PURA: devuelve el manifest sin la entrada `slug`,
 * conservando el orden. Igual de tolerante que `mergePanelManifest` a un `raw`
 * ausente, vacio o con JSON corrupto (nunca rompe la despublicacion).
 */
export function removeFromPanelManifest(raw: string | undefined, slug: string): PanelEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // manifest corrupto: se reescribe vacio (nada que preservar con seguridad)
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is PanelEntry =>
      typeof item === "object" && item !== null && (item as { slug?: unknown }).slug !== slug,
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function undeploy(slug: string): Promise<Lead> {
  if (!slug) throw new Error("undeploy: falta el slug. Uso: undeploy <slug>");
  if (!isValidSlug(slug)) {
    throw new Error(`undeploy: slug invalido "${slug}". Debe ser kebab-case [a-z0-9-].`);
  }

  loadEnv();
  const cfg = resolveDeployConfig();
  const lead = await readLead(slug);

  const sshArgs = sshBaseArgs(cfg);
  const target = `${cfg.user}@${cfg.host}`;
  const remoteDir = remoteLeadDir(cfg, slug);
  const manifestPath = `${cfg.root}/panelcards/leads.json`;

  // 1) borrar la carpeta remota del lead. remoteDir = <root>/<slug>: root ya se
  // valido absoluto y != "/" en resolveDeployConfig, y slug paso isValidSlug,
  // asi que el rm -rf no puede escaparse a una ruta peligrosa.
  await runCommand("ssh", [...sshArgs, target, `rm -rf ${posixQuote(remoteDir)}`]);

  // 2) sacar el lead del manifest. Si el manifest no existe todavia, no hay
  // nada que actualizar (el lead nunca llego a listarse).
  let raw: string | undefined;
  try {
    const { stdout } = await runCommand("ssh", [...sshArgs, target, `cat ${posixQuote(manifestPath)}`]);
    raw = stdout;
  } catch {
    raw = undefined;
  }
  if (raw !== undefined) {
    const remaining = removeFromPanelManifest(raw, slug);
    const tmpFile = path.join(os.tmpdir(), `card-leads-panel-${slug}-${Date.now()}.json`);
    await fs.writeFile(tmpFile, JSON.stringify(remaining, null, 2) + "\n", "utf8");
    try {
      await runCommand("scp", [...sshArgs, tmpFile, `${target}:${manifestPath}`]);
    } finally {
      await fs.rm(tmpFile, { force: true });
    }
  }

  // 3) persistir: limpiar de `generated` lo que apuntaba al server publico y
  // regresar el status al ultimo estado "construido" (nunca avanzarlo). El
  // mensaje de contacto se borra porque embebia las URLs ahora muertas.
  const localDir = leadDir(slug);
  const hasWeb = await fileExists(path.join(localDir, "web", "index.html"));
  const hasDc = await fileExists(path.join(localDir, "dc", "index.html"));
  const order = StatusSchema.options;
  const builtCeiling: Status = hasWeb ? "web_built" : hasDc ? "linktree_built" : lead.status;
  const status: Status =
    order.indexOf(lead.status) > order.indexOf(builtCeiling) ? builtCeiling : lead.status;

  const { dc_url, web_url, outreach_message, ...restGenerated } = lead.generated;
  const updated: Lead = { ...lead, status, generated: restGenerated };
  await writeLead(updated);
  return updated;
}

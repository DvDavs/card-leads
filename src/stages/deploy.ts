import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { loadEnv } from "../lib/env.js";
import { StatusSchema, type Lead, type Status } from "../lib/schema.js";
import { isValidSlug } from "../lib/slug.js";
import { leadDir, readLead, writeLead } from "../lib/storage.js";
import { runCommand } from "../lib/ssh.js";
import { buildCards } from "./build-cards.js";

/**
 * deploy — sube `leads/<slug>/dc/` y/o `leads/<slug>/web/` al droplet por
 * scp, mantiene el manifest del panel (`panelcards/leads.json`) y persiste
 * `generated.dc_url`/`web_url` con las URLs publicas absolutas. `data.json`
 * y las fotos de la tarjeta NUNCA se suben (datos personales).
 */

export interface DeployConfig {
  host: string;
  user: string;
  root: string;
  baseUrl: string;
  sshKey?: string;
}

/**
 * resolveDeployConfig — lee la config del deploy desde el entorno. `DEPLOY_HOST`
 * y `DEPLOY_BASE_URL` son obligatorios; el resto tiene default. `DEPLOY_ROOT`
 * se valida (ruta absoluta, nunca "/") porque se interpola en un `rm -rf`
 * remoto mas adelante.
 */
export function resolveDeployConfig(env: NodeJS.ProcessEnv = process.env): DeployConfig {
  const host = env.DEPLOY_HOST;
  if (!host) throw new Error("deploy: falta DEPLOY_HOST en el entorno (.env).");

  const baseUrlRaw = env.DEPLOY_BASE_URL;
  if (!baseUrlRaw) throw new Error("deploy: falta DEPLOY_BASE_URL en el entorno (.env).");

  const root = (env.DEPLOY_ROOT || "/var/www/cards").replace(/\/+$/, "");
  if (!root.startsWith("/") || root === "") {
    throw new Error(`deploy: DEPLOY_ROOT invalido ("${env.DEPLOY_ROOT}"): debe ser una ruta absoluta.`);
  }

  return {
    host,
    user: env.DEPLOY_USER || "root",
    root,
    baseUrl: baseUrlRaw.replace(/\/+$/, ""),
    sshKey: env.DEPLOY_SSH_KEY || undefined,
  };
}

/** Flags comunes de ssh/scp: nunca colgarse en un prompt, aceptar host nuevo, timeout corto. */
export function sshBaseArgs(cfg: DeployConfig): string[] {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
  ];
  if (cfg.sshKey) args.push("-i", cfg.sshKey);
  return args;
}

/** Carpeta remota del lead. Concatenacion posix manual (el droplet es Linux, nunca path.join). */
export function remoteLeadDir(cfg: DeployConfig, slug: string): string {
  return `${cfg.root}/${slug}`;
}

/** URL publica absoluta de un artefacto ("dc" | "web"), con slash final. */
export function publicUrl(cfg: DeployConfig, slug: string, kind: "dc" | "web"): string {
  return `${cfg.baseUrl}/${slug}/${kind}/`;
}

/** Escapa un valor para interpolarlo seguro dentro de un comando de shell POSIX remoto. */
export function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/* ------------------------------------------------------------------ */
/* Manifest del panel                                                  */
/* ------------------------------------------------------------------ */

export const PanelEntrySchema = z.object({
  slug: z.string(),
  name: z.string(),
  rubro: z.string(),
  dc_url: z.string().optional(),
  web_url: z.string().optional(),
  deployed_at: z.string(),
});
export type PanelEntry = z.infer<typeof PanelEntrySchema>;

/**
 * mergePanelManifest — PURA: agrega/reemplaza `entry` por slug en el manifest
 * y ordena por `deployed_at` desc. Tolerante a `raw` ausente, vacio o con JSON
 * corrupto (el panel nunca debe romper el redeploy de un lead).
 */
export function mergePanelManifest(raw: string | undefined, entry: PanelEntry): PanelEntry[] {
  let entries: PanelEntry[] = [];
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        entries = parsed.flatMap((item) => {
          const result = PanelEntrySchema.safeParse(item);
          return result.success ? [result.data] : [];
        });
      }
    } catch {
      entries = []; // manifest corrupto: se reconstruye desde este entry
    }
  }
  const merged = [...entries.filter((e) => e.slug !== entry.slug), entry];
  merged.sort((a, b) => (a.deployed_at < b.deployed_at ? 1 : a.deployed_at > b.deployed_at ? -1 : 0));
  return merged;
}

/* ------------------------------------------------------------------ */
/* Guard de status                                                     */
/* ------------------------------------------------------------------ */

/**
 * Publicable desde "linktree_built" (build-cards ya corrio) en adelante,
 * "error" excluido. Que dc/ y/o web/ existan de verdad lo chequea `deploy`
 * contra el filesystem, no este guard.
 */
export function assertDeployableStatus(status: Status): void {
  const order = StatusSchema.options;
  const ok = status !== "error" && order.indexOf(status) >= order.indexOf("linktree_built");
  if (ok) return;
  throw new Error(
    `deploy: el lead esta en status "${status}" y se requiere "linktree_built" o posterior. Ejecuta primero \`build-cards\`.`,
  );
}

/* ------------------------------------------------------------------ */
/* Etapa CLI                                                           */
/* ------------------------------------------------------------------ */

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function deploy(slug: string): Promise<Lead> {
  if (!slug) throw new Error("deploy: falta el slug. Uso: deploy <slug>");
  if (!isValidSlug(slug)) {
    throw new Error(`deploy: slug invalido "${slug}". Debe ser kebab-case [a-z0-9-].`);
  }

  loadEnv();
  const cfg = resolveDeployConfig();
  let lead = await readLead(slug);
  assertDeployableStatus(lead.status);

  const localDir = leadDir(slug);
  const hadDc = await fileExists(path.join(localDir, "dc", "index.html"));

  // Re-generar dc/ contra el status ACTUAL antes de subir, SOLO si ya existia:
  // build-cards corre primero en el pipeline feliz (demo rapida antes de
  // comprometerse a una web completa, ver [[digital-cards-architecture]]),
  // asi que la primera vez que escribio dc/ el status todavia no llegaba a
  // "web_built" y el link "Ver mi sitio" (hasGeneratedWebsite) quedaba
  // permanentemente apagado en el HTML ya escrito en disco. Re-ejecutarlo aca
  // no regresiona el status (buildCards nunca lo hace retroceder) y deja dc/
  // consistente con el status final justo antes de publicarlo. Gateado por
  // `hadDc` para no fabricar un dc/ que nunca se pidio (preserva el guard de
  // "ni dc ni web construidos: deploy no hace ninguna llamada de red").
  if (hadDc) {
    await buildCards(slug);
    lead = await readLead(slug);
  }

  const hasDc = await fileExists(path.join(localDir, "dc", "index.html"));
  const hasWeb = await fileExists(path.join(localDir, "web", "index.html"));
  if (!hasDc && !hasWeb) {
    throw new Error(
      `deploy: "${slug}" no tiene dc/index.html ni web/index.html. Ejecuta build-cards y/o build-web primero.`,
    );
  }

  const sshArgs = sshBaseArgs(cfg);
  const target = `${cfg.user}@${cfg.host}`;
  const remoteDir = remoteLeadDir(cfg, slug);
  const panelDir = `${cfg.root}/panelcards`;
  const manifestPath = `${panelDir}/leads.json`;

  // 1) preparacion: crea directorios + limpia lo que se va a resubir (redeploy idempotente).
  const toClear = [hasDc ? `${remoteDir}/dc` : null, hasWeb ? `${remoteDir}/web` : null].filter(
    (x): x is string => x !== null,
  );
  const prepParts = [`mkdir -p ${posixQuote(remoteDir)} ${posixQuote(panelDir)}`];
  if (toClear.length > 0) prepParts.push(`rm -rf ${toClear.map(posixQuote).join(" ")}`);
  await runCommand("ssh", [...sshArgs, target, prepParts.join(" && ")]);

  // 2) sube dc/ y web/. cwd = carpeta del lead + source relativo: esquiva la
  // ambiguedad "C:\" vs "host:path" de scp en Windows. data.json y las fotos
  // de la tarjeta viven fuera de dc/ y web/, asi que nunca se suben.
  if (hasDc) {
    await runCommand("scp", [...sshArgs, "-r", "dc", `${target}:${remoteDir}/`], { cwd: localDir });
  }
  if (hasWeb) {
    await runCommand("scp", [...sshArgs, "-r", "web", `${target}:${remoteDir}/`], { cwd: localDir });
  }

  // 3) manifest AL FINAL: el panel nunca lista un lead a medio subir.
  let raw: string | undefined;
  try {
    const { stdout } = await runCommand("ssh", [...sshArgs, target, `cat ${posixQuote(manifestPath)}`]);
    raw = stdout;
  } catch {
    raw = undefined; // manifest todavia no existe: primer deploy
  }

  const entry: PanelEntry = {
    slug,
    name: lead.business.person_name || lead.business.name || slug,
    rubro: lead.rubro,
    ...(hasDc ? { dc_url: publicUrl(cfg, slug, "dc") } : {}),
    ...(hasWeb ? { web_url: publicUrl(cfg, slug, "web") } : {}),
    deployed_at: new Date().toISOString(),
  };
  const merged = mergePanelManifest(raw, entry);

  const tmpFile = path.join(os.tmpdir(), `card-leads-panel-${slug}-${Date.now()}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(merged, null, 2) + "\n", "utf8");
  try {
    await runCommand("scp", [...sshArgs, tmpFile, `${target}:${manifestPath}`]);
  } finally {
    await fs.rm(tmpFile, { force: true });
  }

  // 4) persistir: status "deployed" (sin regresion) + URLs publicas absolutas.
  const order = StatusSchema.options;
  const status: Status =
    order.indexOf(lead.status) < order.indexOf("deployed") ? "deployed" : lead.status;

  const updated: Lead = {
    ...lead,
    status,
    generated: {
      ...lead.generated,
      ...(hasDc ? { dc_url: publicUrl(cfg, slug, "dc") } : {}),
      ...(hasWeb ? { web_url: publicUrl(cfg, slug, "web") } : {}),
    },
  };
  await writeLead(updated);
  return updated;
}

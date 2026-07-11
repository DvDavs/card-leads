import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/ssh.js", () => ({
  runCommand: vi.fn(),
}));

import { loadEnv } from "../../src/lib/env.js";
import { StatusSchema, type Lead } from "../../src/lib/schema.js";
import { leadDir, readLead, writeArtifact, writeLead } from "../../src/lib/storage.js";
import { runCommand } from "../../src/lib/ssh.js";
import {
  assertDeployableStatus,
  deploy,
  mergePanelManifest,
  publicUrl,
  remoteLeadDir,
  resolveDeployConfig,
  sshBaseArgs,
  type DeployConfig,
  type PanelEntry,
} from "../../src/stages/deploy.js";

/**
 * Tests deterministas de deploy: helpers puros (config, args de ssh, URLs
 * publicas, merge del manifest, guard de status) y el FLUJO completo con
 * `src/lib/ssh.js` mockeado (unico punto que toca la red) contra un
 * `LEADS_DIR` temporal real. `data.json` y las fotos de la tarjeta nunca
 * entran a un comando ssh/scp en ningun test: es lo que se verifica en
 * "nunca sube datos personales".
 */

const runCommandMock = vi.mocked(runCommand);

/* ------------------------------------------------------------------ */
/* Helpers de fixture                                                  */
/* ------------------------------------------------------------------ */

function deployableLead(overrides: Partial<Lead> = {}): Lead {
  return {
    slug: "carlos-doc",
    status: "linktree_built",
    rubro: "doctor",
    source: {
      card_front: "card_front.jpg",
      card_back: "card_back.jpg",
      ingested_at: "2026-07-01T00:00:00.000Z",
      channel: "manual",
    },
    business: { name: "Clinica X", person_name: "Dr. Carlos Perez", attrs: {} },
    contact: { phones: ["9511234567"] },
    socials: {},
    brand: { colors: {}, has_logo: false },
    content: { services: ["Consulta"] },
    generated: {},
    meta: { needs: [], errors: [], updated_at: "2026-07-01T00:00:00.000Z" },
    ...overrides,
  };
}

async function seedLead(
  lead: Lead,
  artifacts: { dc?: boolean; web?: boolean } = { dc: true, web: true },
): Promise<void> {
  await writeLead(lead);
  if (artifacts.dc) await writeArtifact(lead.slug, "dc/index.html", "<html>dc</html>");
  if (artifacts.web) await writeArtifact(lead.slug, "web/index.html", "<html>web</html>");
}

interface RecordedCall {
  cmd: string;
  args: string[];
  cwd?: string;
}

/** Clasifica una llamada mockeada por lo que hace, para asserts de orden legibles. */
function callKind(call: RecordedCall): string {
  const last = call.args[call.args.length - 1] ?? "";
  if (call.cmd === "ssh" && last.startsWith("mkdir -p")) return "prep";
  if (call.cmd === "ssh" && last.startsWith("cat ")) return "manifest-read";
  if (call.cmd === "scp" && call.args.includes("dc")) return "scp-dc";
  if (call.cmd === "scp" && call.args.includes("web")) return "scp-web";
  if (call.cmd === "scp") return "manifest-write";
  return "unknown";
}

/**
 * Instala la implementacion del mock de runCommand: responde "cat" del
 * manifest con `manifestRaw` (o tira ENOENT si es undefined, como el droplet
 * en el primer deploy), y captura el manifest que se sube (leyendo el archivo
 * temporal ANTES de que deploy.ts lo borre en su `finally`).
 */
function mockSsh(manifestRaw: string | undefined) {
  const calls: RecordedCall[] = [];
  let uploadedManifest: unknown;

  runCommandMock.mockImplementation(async (cmd, args, options) => {
    calls.push({ cmd, args, cwd: options?.cwd });
    const last = args[args.length - 1] ?? "";

    if (cmd === "ssh" && last.startsWith("cat ")) {
      if (manifestRaw === undefined) throw new Error("cat: No such file or directory");
      return { stdout: manifestRaw, stderr: "" };
    }
    if (cmd === "scp" && !args.includes("-r")) {
      const tmpFile = args[args.length - 2]!;
      uploadedManifest = JSON.parse(readFileSync(tmpFile, "utf8"));
    }
    return { stdout: "", stderr: "" };
  });

  return {
    calls,
    kinds: () => calls.map(callKind),
    getUploadedManifest: () => uploadedManifest as PanelEntry[] | undefined,
  };
}

/* ------------------------------------------------------------------ */
/* resolveDeployConfig                                                 */
/* ------------------------------------------------------------------ */

describe("resolveDeployConfig", () => {
  it("exige DEPLOY_HOST", () => {
    expect(() => resolveDeployConfig({ DEPLOY_BASE_URL: "https://x.test" })).toThrow(/DEPLOY_HOST/);
  });

  it("exige DEPLOY_BASE_URL", () => {
    expect(() => resolveDeployConfig({ DEPLOY_HOST: "1.2.3.4" })).toThrow(/DEPLOY_BASE_URL/);
  });

  it("defaults: DEPLOY_USER=root, DEPLOY_ROOT=/var/www/cards, sin llave", () => {
    const cfg = resolveDeployConfig({ DEPLOY_HOST: "1.2.3.4", DEPLOY_BASE_URL: "https://x.test" });
    expect(cfg).toEqual({
      host: "1.2.3.4",
      user: "root",
      root: "/var/www/cards",
      baseUrl: "https://x.test",
      sshKey: undefined,
    });
  });

  it("normaliza: recorta slash final de DEPLOY_ROOT y DEPLOY_BASE_URL", () => {
    const cfg = resolveDeployConfig({
      DEPLOY_HOST: "1.2.3.4",
      DEPLOY_BASE_URL: "https://x.test/",
      DEPLOY_ROOT: "/var/www/cards/",
    });
    expect(cfg.root).toBe("/var/www/cards");
    expect(cfg.baseUrl).toBe("https://x.test");
  });

  it("toma DEPLOY_USER y DEPLOY_SSH_KEY cuando estan presentes", () => {
    const cfg = resolveDeployConfig({
      DEPLOY_HOST: "1.2.3.4",
      DEPLOY_BASE_URL: "https://x.test",
      DEPLOY_USER: "deploy",
      DEPLOY_SSH_KEY: "/home/x/.ssh/cards_deploy",
    });
    expect(cfg.user).toBe("deploy");
    expect(cfg.sshKey).toBe("/home/x/.ssh/cards_deploy");
  });

  it("rechaza DEPLOY_ROOT relativo o vacio", () => {
    expect(() =>
      resolveDeployConfig({ DEPLOY_HOST: "1.2.3.4", DEPLOY_BASE_URL: "https://x.test", DEPLOY_ROOT: "var/www" }),
    ).toThrow(/DEPLOY_ROOT/);
  });

  it('rechaza DEPLOY_ROOT="/" (se interpola en un rm -rf remoto)', () => {
    expect(() =>
      resolveDeployConfig({ DEPLOY_HOST: "1.2.3.4", DEPLOY_BASE_URL: "https://x.test", DEPLOY_ROOT: "/" }),
    ).toThrow(/DEPLOY_ROOT/);
  });
});

/* ------------------------------------------------------------------ */
/* sshBaseArgs / remoteLeadDir / publicUrl                             */
/* ------------------------------------------------------------------ */

describe("sshBaseArgs", () => {
  const base: DeployConfig = {
    host: "1.2.3.4",
    user: "root",
    root: "/var/www/cards",
    baseUrl: "https://x.test",
  };

  it("siempre trae BatchMode, StrictHostKeyChecking y ConnectTimeout", () => {
    const args = sshBaseArgs(base);
    expect(args).toEqual(["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10"]);
  });

  it("agrega -i cuando hay sshKey", () => {
    const args = sshBaseArgs({ ...base, sshKey: "/home/x/.ssh/cards_deploy" });
    expect(args.slice(-2)).toEqual(["-i", "/home/x/.ssh/cards_deploy"]);
  });
});

describe("remoteLeadDir / publicUrl", () => {
  const cfg: DeployConfig = { host: "1.2.3.4", user: "root", root: "/var/www/cards", baseUrl: "https://x.test" };

  it("remoteLeadDir concatena root + slug, sin path.join", () => {
    expect(remoteLeadDir(cfg, "carlos-doc")).toBe("/var/www/cards/carlos-doc");
  });

  it("publicUrl arma baseUrl/slug/kind/ con slash final", () => {
    expect(publicUrl(cfg, "carlos-doc", "dc")).toBe("https://x.test/carlos-doc/dc/");
    expect(publicUrl(cfg, "carlos-doc", "web")).toBe("https://x.test/carlos-doc/web/");
  });
});

/* ------------------------------------------------------------------ */
/* assertDeployableStatus                                              */
/* ------------------------------------------------------------------ */

describe("assertDeployableStatus", () => {
  it("rechaza estados previos a linktree_built", () => {
    expect(() => assertDeployableStatus("ingested")).toThrow(/build-cards/);
    expect(() => assertDeployableStatus("extracted")).toThrow(/build-cards/);
    expect(() => assertDeployableStatus("verified")).toThrow(/build-cards/);
  });

  it('rechaza "error" aunque en el enum quede despues de linktree_built', () => {
    expect(() => assertDeployableStatus("error")).toThrow(/error/);
  });

  it("acepta linktree_built y todos los estados posteriores del camino feliz", () => {
    const order = StatusSchema.options;
    const desde = order.slice(order.indexOf("linktree_built")).filter((s) => s !== "error");
    for (const status of desde) {
      expect(() => assertDeployableStatus(status)).not.toThrow();
    }
  });
});

/* ------------------------------------------------------------------ */
/* mergePanelManifest                                                  */
/* ------------------------------------------------------------------ */

describe("mergePanelManifest", () => {
  const entry: PanelEntry = {
    slug: "carlos-doc",
    name: "Dr. Carlos Perez",
    rubro: "doctor",
    dc_url: "https://x.test/carlos-doc/dc/",
    deployed_at: "2026-07-10T00:00:00.000Z",
  };

  it("manifest ausente => [entry]", () => {
    expect(mergePanelManifest(undefined, entry)).toEqual([entry]);
  });

  it("manifest corrupto (JSON invalido) => se reconstruye desde entry", () => {
    expect(mergePanelManifest("{not json", entry)).toEqual([entry]);
  });

  it("JSON valido pero no-array => tratado como sin entradas previas", () => {
    expect(mergePanelManifest('{"foo":"bar"}', entry)).toEqual([entry]);
  });

  it("reemplaza la entrada existente del mismo slug (no duplica)", () => {
    const previo = JSON.stringify([{ ...entry, name: "Nombre viejo", deployed_at: "2026-01-01T00:00:00.000Z" }]);
    const merged = mergePanelManifest(previo, entry);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(entry);
  });

  it("ordena por deployed_at descendente y conserva otros slugs", () => {
    const otro: PanelEntry = {
      slug: "otro-lead",
      name: "Otro",
      rubro: "barberia",
      deployed_at: "2026-01-01T00:00:00.000Z",
    };
    const merged = mergePanelManifest(JSON.stringify([otro]), entry);
    expect(merged.map((e) => e.slug)).toEqual(["carlos-doc", "otro-lead"]);
  });

  it("descarta entradas que no cumplen el schema (defensivo ante manifest a mano)", () => {
    const previo = JSON.stringify([{ slug: "roto" /* sin name/rubro/deployed_at */ }]);
    expect(mergePanelManifest(previo, entry)).toEqual([entry]);
  });
});

/* ------------------------------------------------------------------ */
/* Flujo completo: runCommand mockeado + LEADS_DIR temporal            */
/* ------------------------------------------------------------------ */

describe("deploy — flujo completo", () => {
  let tmpRoot: string;

  beforeAll(() => {
    // Pre-calienta loadEnv() ANTES de fijar los env vars del test: asi el
    // .env real del repo (si existe) no pisa DEPLOY_HOST/DEPLOY_BASE_URL de
    // las pruebas (loadEnv() solo corre una vez por proceso).
    loadEnv();
  });

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "card-leads-deploy-"));
    process.env.LEADS_DIR = tmpRoot;
    process.env.DEPLOY_HOST = "203.0.113.10";
    process.env.DEPLOY_BASE_URL = "https://cards.kronet.app";
    delete process.env.DEPLOY_USER;
    delete process.env.DEPLOY_ROOT;
    delete process.env.DEPLOY_SSH_KEY;
    runCommandMock.mockReset();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.LEADS_DIR;
    delete process.env.DEPLOY_HOST;
    delete process.env.DEPLOY_BASE_URL;
  });

  it("dc + web: orden de comandos prep -> scp dc -> scp web -> cat -> scp manifest", async () => {
    const lead = deployableLead();
    await seedLead(lead);
    const ssh = mockSsh(undefined);

    await deploy(lead.slug);

    expect(ssh.kinds()).toEqual(["prep", "scp-dc", "scp-web", "manifest-read", "manifest-write"]);
  });

  it("el prep hace mkdir de la carpeta del lead + panelcards y rm -rf de dc y web", async () => {
    const lead = deployableLead();
    await seedLead(lead);
    const ssh = mockSsh(undefined);

    await deploy(lead.slug);

    const prep = ssh.calls[0]!.args.at(-1)!;
    expect(prep).toContain("mkdir -p");
    expect(prep).toContain("/var/www/cards/carlos-doc");
    expect(prep).toContain("/var/www/cards/panelcards");
    expect(prep).toContain("rm -rf");
    expect(prep).toContain("/var/www/cards/carlos-doc/dc");
    expect(prep).toContain("/var/www/cards/carlos-doc/web");
  });

  it("scp de dc/web corre con cwd = carpeta local del lead y source relativo", async () => {
    const lead = deployableLead();
    await seedLead(lead);
    const ssh = mockSsh(undefined);

    await deploy(lead.slug);

    const scpDc = ssh.calls.find((c) => callKind(c) === "scp-dc")!;
    const scpWeb = ssh.calls.find((c) => callKind(c) === "scp-web")!;
    expect(scpDc.cwd).toBe(leadDir(lead.slug));
    expect(scpWeb.cwd).toBe(leadDir(lead.slug));
    expect(scpDc.args).toContain("dc");
    expect(scpWeb.args).toContain("web");
  });

  it("manifest subido: entry con name/rubro/URLs absolutas del lead", async () => {
    const lead = deployableLead();
    await seedLead(lead);
    const ssh = mockSsh(undefined);

    await deploy(lead.slug);

    const manifest = ssh.getUploadedManifest()!;
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({
      slug: "carlos-doc",
      name: "Dr. Carlos Perez",
      rubro: "doctor",
      dc_url: "https://cards.kronet.app/carlos-doc/dc/",
      web_url: "https://cards.kronet.app/carlos-doc/web/",
    });
  });

  it("manifest existente con otro slug: se conserva y la entrada propia se reemplaza (no duplica)", async () => {
    const lead = deployableLead();
    await seedLead(lead);
    const previo = JSON.stringify([
      { slug: "otro-lead", name: "Otro", rubro: "barberia", deployed_at: "2026-01-01T00:00:00.000Z" },
      { slug: "carlos-doc", name: "Nombre viejo", rubro: "doctor", deployed_at: "2025-01-01T00:00:00.000Z" },
    ]);
    const ssh = mockSsh(previo);

    await deploy(lead.slug);

    const manifest = ssh.getUploadedManifest()!;
    expect(manifest).toHaveLength(2);
    expect(manifest.filter((e) => e.slug === "carlos-doc")).toHaveLength(1);
    expect(manifest.find((e) => e.slug === "carlos-doc")!.name).toBe("Dr. Carlos Perez");
    expect(manifest.find((e) => e.slug === "otro-lead")).toBeDefined();
  });

  it("redeploy: la segunda corrida no duplica la entrada del mismo slug", async () => {
    const lead = deployableLead();
    await seedLead(lead);

    const ssh1 = mockSsh(undefined);
    await deploy(lead.slug);
    const afterFirst = ssh1.getUploadedManifest()!;
    expect(afterFirst).toHaveLength(1);

    const ssh2 = mockSsh(JSON.stringify(afterFirst));
    await deploy(lead.slug);
    const afterSecond = ssh2.getUploadedManifest()!;
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]!.slug).toBe("carlos-doc");
  });

  it("variante dc-only: sin web/index.html no hay scp-web ni web_url en el manifest", async () => {
    const lead = deployableLead();
    await seedLead(lead, { dc: true, web: false });
    const ssh = mockSsh(undefined);

    await deploy(lead.slug);

    expect(ssh.kinds()).toEqual(["prep", "scp-dc", "manifest-read", "manifest-write"]);
    const manifest = ssh.getUploadedManifest()!;
    expect(manifest[0]!.dc_url).toBe("https://cards.kronet.app/carlos-doc/dc/");
    expect(manifest[0]!.web_url).toBeUndefined();
  });

  it("sin dc/ ni web/ construidos: no se hace NINGUNA llamada de red", async () => {
    const lead = deployableLead();
    await seedLead(lead, { dc: false, web: false });
    mockSsh(undefined);

    await expect(deploy(lead.slug)).rejects.toThrow(/dc\/index\.html.*web\/index\.html|build-cards|build-web/);
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it("status anterior a linktree_built: rechazado antes de tocar red", async () => {
    const lead = deployableLead({ status: "verified" });
    await writeLead(lead);
    mockSsh(undefined);

    await expect(deploy(lead.slug)).rejects.toThrow(/build-cards/);
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it("data.json final: status deployed + URLs absolutas persistidas", async () => {
    const lead = deployableLead();
    await seedLead(lead);
    mockSsh(undefined);

    const result = await deploy(lead.slug);
    expect(result.status).toBe("deployed");

    const onDisk = await readLead(lead.slug);
    expect(onDisk.status).toBe("deployed");
    expect(onDisk.generated.dc_url).toBe("https://cards.kronet.app/carlos-doc/dc/");
    expect(onDisk.generated.web_url).toBe("https://cards.kronet.app/carlos-doc/web/");
  });

  it("no-regresion de status: un lead ya mas adelante (packaged) no retrocede a deployed", async () => {
    const lead = deployableLead({ status: "packaged" });
    await seedLead(lead);
    mockSsh(undefined);

    const result = await deploy(lead.slug);
    expect(result.status).toBe("packaged");
  });

  it("nunca pasa data.json ni las fotos de la tarjeta en ningun comando ssh/scp", async () => {
    const lead = deployableLead();
    await seedLead(lead);
    const ssh = mockSsh(undefined);

    await deploy(lead.slug);

    const allArgsJoined = ssh.calls.map((c) => c.args.join(" ")).join(" | ");
    expect(allArgsJoined).not.toMatch(/data\.json|card_front|card_back/);
  });
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/ssh.js", () => ({
  runCommand: vi.fn(),
}));

import { type Lead } from "../../src/lib/schema.js";
import { leadDir, readLead, writeArtifact, writeLead } from "../../src/lib/storage.js";
import { runCommand } from "../../src/lib/ssh.js";
import { type PanelEntry } from "../../src/stages/deploy.js";
import { removeFromPanelManifest, undeploy } from "../../src/stages/undeploy.js";

/**
 * Tests deterministas de undeploy: el helper puro (removeFromPanelManifest) y
 * el FLUJO completo con `src/lib/ssh.js` mockeado (unico punto que toca la
 * red) contra un `LEADS_DIR` temporal real. Verifica que borra la carpeta
 * remota, reescribe el manifest sin el slug, y regresa el status + limpia las
 * URLs y el mensaje de contacto sin tocar la carpeta local.
 */

const runCommandMock = vi.mocked(runCommand);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function deployedLead(overrides: Partial<Lead> = {}): Lead {
  return {
    slug: "carlos-doc",
    status: "deployed",
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
    generated: {
      dc_url: "https://cards.test/carlos-doc/dc/",
      web_url: "https://cards.test/carlos-doc/web/",
      outreach_message: "Hola, mira tu tarjeta: https://cards.test/carlos-doc/dc/",
    },
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
}

/**
 * Mock de runCommand: responde el "cat" del manifest con `manifestRaw` (o tira
 * ENOENT si es undefined) y captura el manifest que se sube (leyendo el temp
 * file ANTES de que undeploy.ts lo borre en su `finally`).
 */
function mockSsh(manifestRaw: string | undefined) {
  const calls: RecordedCall[] = [];
  let uploadedManifest: unknown;

  runCommandMock.mockImplementation(async (cmd, args) => {
    calls.push({ cmd, args });
    const last = args[args.length - 1] ?? "";
    if (cmd === "ssh" && last.startsWith("cat ")) {
      if (manifestRaw === undefined) throw new Error("cat: No such file or directory");
      return { stdout: manifestRaw, stderr: "" };
    }
    if (cmd === "scp") {
      const tmpFile = args[args.length - 2]!;
      uploadedManifest = JSON.parse(readFileSync(tmpFile, "utf8"));
    }
    return { stdout: "", stderr: "" };
  });

  return { calls, getUploadedManifest: () => uploadedManifest as PanelEntry[] | undefined };
}

const DEPLOY_ENV = {
  DEPLOY_HOST: "1.2.3.4",
  DEPLOY_BASE_URL: "https://cards.test",
  DEPLOY_ROOT: "/var/www/cards",
};

/* ------------------------------------------------------------------ */
/* Helper puro                                                         */
/* ------------------------------------------------------------------ */

describe("removeFromPanelManifest", () => {
  const entry = (slug: string): PanelEntry => ({
    slug,
    name: slug,
    rubro: "doctor",
    deployed_at: "2026-07-01T00:00:00.000Z",
  });

  it("saca la entrada del slug y conserva el resto", () => {
    const raw = JSON.stringify([entry("a"), entry("carlos-doc"), entry("b")]);
    const out = removeFromPanelManifest(raw, "carlos-doc");
    expect(out.map((e) => e.slug)).toEqual(["a", "b"]);
  });

  it("es idempotente si el slug no esta", () => {
    const raw = JSON.stringify([entry("a"), entry("b")]);
    expect(removeFromPanelManifest(raw, "carlos-doc").map((e) => e.slug)).toEqual(["a", "b"]);
  });

  it("tolera raw ausente / vacio / corrupto devolviendo []", () => {
    expect(removeFromPanelManifest(undefined, "x")).toEqual([]);
    expect(removeFromPanelManifest("", "x")).toEqual([]);
    expect(removeFromPanelManifest("{no json", "x")).toEqual([]);
    expect(removeFromPanelManifest('{"not":"array"}', "x")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Flujo completo                                                      */
/* ------------------------------------------------------------------ */

describe("undeploy (flujo)", () => {
  let tmpDir: string;
  const prevEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ["DEPLOY_HOST", "DEPLOY_BASE_URL", "DEPLOY_ROOT", "DEPLOY_USER", "DEPLOY_SSH_KEY", "LEADS_DIR"]) {
      prevEnv[k] = process.env[k];
    }
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "undeploy-test-"));
    process.env.LEADS_DIR = tmpDir;
    Object.assign(process.env, DEPLOY_ENV);
    runCommandMock.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("borra la carpeta remota, actualiza el manifest y regresa el status", async () => {
    await seedLead(deployedLead());
    const raw = JSON.stringify([
      { slug: "carlos-doc", name: "Dr. Carlos", rubro: "doctor", deployed_at: "2026-07-01T00:00:00.000Z" },
      { slug: "otra", name: "Otra", rubro: "otro", deployed_at: "2026-07-02T00:00:00.000Z" },
    ]);
    const rec = mockSsh(raw);

    const lead = await undeploy("carlos-doc");

    // rm -rf de la carpeta remota exacta (root/slug), citada.
    const rm = rec.calls.find((c) => c.cmd === "ssh" && c.args[c.args.length - 1]!.startsWith("rm -rf"));
    expect(rm).toBeTruthy();
    expect(rm!.args[rm!.args.length - 1]).toBe("rm -rf '/var/www/cards/carlos-doc'");

    // Manifest reescrito sin el slug.
    expect(rec.getUploadedManifest()!.map((e) => e.slug)).toEqual(["otra"]);

    // Status regresa a web_built (hay web/) y se limpian las URLs + mensaje.
    expect(lead.status).toBe("web_built");
    expect(lead.generated.dc_url).toBeUndefined();
    expect(lead.generated.web_url).toBeUndefined();
    expect(lead.generated.outreach_message).toBeUndefined();

    // Persistido en disco.
    const reread = await readLead("carlos-doc");
    expect(reread.status).toBe("web_built");
    expect(reread.generated.web_url).toBeUndefined();
  });

  it("regresa a linktree_built si solo hay dc/ (sin web/)", async () => {
    await seedLead(deployedLead(), { dc: true, web: false });
    mockSsh(JSON.stringify([]));
    const lead = await undeploy("carlos-doc");
    expect(lead.status).toBe("linktree_built");
  });

  it("no rompe si el manifest remoto no existe", async () => {
    await seedLead(deployedLead());
    const rec = mockSsh(undefined); // cat falla
    const lead = await undeploy("carlos-doc");
    expect(lead.generated.dc_url).toBeUndefined();
    // No se intento subir manifest (no habia nada que actualizar).
    expect(rec.getUploadedManifest()).toBeUndefined();
    // Igual borro la carpeta remota.
    expect(rec.calls.some((c) => c.args[c.args.length - 1]!.startsWith("rm -rf"))).toBe(true);
  });

  it("no borra la carpeta local del lead", async () => {
    await seedLead(deployedLead());
    mockSsh(JSON.stringify([]));
    await undeploy("carlos-doc");
    // dc/index.html sigue en disco.
    expect(readFileSync(path.join(leadDir("carlos-doc"), "dc", "index.html"), "utf8")).toContain("dc");
  });

  it("rechaza slug invalido antes de tocar la red", async () => {
    await expect(undeploy("../escape")).rejects.toThrow(/slug invalido/);
    expect(runCommandMock).not.toHaveBeenCalled();
  });
});

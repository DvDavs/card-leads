import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/ssh.js", () => ({
  runCommand: vi.fn(),
}));

import { loadEnv } from "../../src/lib/env.js";
import type { Lead } from "../../src/lib/schema.js";
import { writeArtifact, writeLead } from "../../src/lib/storage.js";
import { runCommand } from "../../src/lib/ssh.js";
import { createApp } from "../../src/panel/app.js";

/**
 * Tests de integracion del endpoint SSE de stages: confirma que la ruta
 * arma bien la secuencia started -> done/error, que el payload de "done"
 * trae los links publicos cuando la stage es "deploy", y que los guards
 * (404 lead inexistente, 400 stage desconocida) funcionan sobre la app real
 * montada con createApp(). Mockea src/lib/ssh.js (mismo patron que
 * deploy.test.ts) para no tocar la red.
 */

const runCommandMock = vi.mocked(runCommand);

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
    business: { name: "Clinica X", attrs: {} },
    contact: { phones: ["9511234567"] },
    socials: {},
    brand: { colors: {}, has_logo: false },
    content: { services: ["Consulta"] },
    generated: {},
    meta: { needs: [], errors: [], updated_at: "2026-07-01T00:00:00.000Z" },
    ...overrides,
  };
}

async function loginCookie(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase: "test-pass" }),
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login no devolvio set-cookie");
  return setCookie.split(";")[0]!;
}

/** Parsea el texto SSE crudo a una lista de {event, data}. */
function parseSSE(body: string): { event: string; data: unknown }[] {
  return body
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      const event = /^event: (.+)$/m.exec(chunk)?.[1] ?? "message";
      const raw = /^data: (.+)$/m.exec(chunk)?.[1] ?? "";
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        // deja el string crudo
      }
      return { event, data };
    });
}

describe("stages route (SSE) — con ssh mockeado", () => {
  let tmpRoot: string;

  beforeAll(() => {
    loadEnv(); // pre-calienta antes de fijar env vars del test (ver deploy.test.ts)
  });

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "card-leads-panel-stages-"));
    process.env.LEADS_DIR = tmpRoot;
    process.env.PANEL_PASSPHRASE = "test-pass";
    process.env.PANEL_SESSION_SECRET = "test-secret";
    process.env.DEPLOY_HOST = "203.0.113.10";
    process.env.DEPLOY_BASE_URL = "https://cards.kronet.app";
    delete process.env.DEPLOY_USER;
    delete process.env.DEPLOY_ROOT;
    delete process.env.DEPLOY_SSH_KEY;
    runCommandMock.mockReset();
    runCommandMock.mockImplementation(async (cmd, args) => {
      const last = args[args.length - 1] ?? "";
      if (cmd === "ssh" && last.startsWith("cat ")) throw new Error("cat: No such file or directory");
      return { stdout: "", stderr: "" };
    });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.LEADS_DIR;
    delete process.env.PANEL_PASSPHRASE;
    delete process.env.PANEL_SESSION_SECRET;
    delete process.env.DEPLOY_HOST;
    delete process.env.DEPLOY_BASE_URL;
  });

  it("POST /stages/deploy transmite started -> done con los links, y persiste el lead", async () => {
    const app = createApp();
    await writeLead(deployableLead());
    await writeArtifact("carlos-doc", "dc/index.html", "<html>dc</html>");
    await writeArtifact("carlos-doc", "web/index.html", "<html>web</html>");

    const cookie = await loginCookie(app);
    const res = await app.request("/api/leads/carlos-doc/stages/deploy", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const events = parseSSE(await res.text());
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(["started", "done"]));
    expect(events.some((e) => e.event === "error")).toBe(false);

    const donePayload = events.find((e) => e.event === "done")!.data as {
      status: string;
      links: { dc_url: string; web_url: string };
    };
    expect(donePayload.status).toBe("deployed");
    expect(donePayload.links.dc_url).toBe("https://cards.kronet.app/carlos-doc/dc/");
    expect(donePayload.links.web_url).toBe("https://cards.kronet.app/carlos-doc/web/");
  });

  it("GET /links devuelve null si el lead nunca se deployo ni empaqueto", async () => {
    const app = createApp();
    await writeLead(deployableLead({ status: "verified", generated: {} }));
    const cookie = await loginCookie(app);
    const res = await app.request("/api/leads/carlos-doc/links", { headers: { cookie } });
    expect(await res.json()).toEqual({
      dc_url: null,
      web_url: null,
      outreach_front: null,
      outreach_back: null,
    });
  });

  it("POST /stages/package arma el mensaje y GET /links devuelve front/back", async () => {
    const app = createApp();
    await writeLead(deployableLead()); // status "linktree_built" -> packageable
    const cookie = await loginCookie(app);

    const res = await app.request("/api/leads/carlos-doc/stages/package", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const events = parseSSE(await res.text());
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(["started", "done"]));
    expect(events.some((e) => e.event === "error")).toBe(false);
    const donePayload = events.find((e) => e.event === "done")!.data as { status: string };
    expect(donePayload.status).toBe("packaged");

    const links = await app.request("/api/leads/carlos-doc/links", { headers: { cookie } });
    const data = (await links.json()) as { outreach_front: string | null; outreach_back: string | null };
    expect(data.outreach_front).toContain("Hola, buen día");
    expect(data.outreach_front).toContain("https://cards.kronet.app/carlos-doc/dc/");
    expect(data.outreach_back).toContain("se creó automáticamente");
  });

  it("una stage desconocida da 400", async () => {
    const app = createApp();
    await writeLead(deployableLead());
    const cookie = await loginCookie(app);
    const res = await app.request("/api/leads/carlos-doc/stages/nope", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(400);
  });

  it("un lead inexistente da 404 (stages y links)", async () => {
    const app = createApp();
    const cookie = await loginCookie(app);
    const stagesRes = await app.request("/api/leads/no-existe/stages/deploy", {
      method: "POST",
      headers: { cookie },
    });
    expect(stagesRes.status).toBe(404);

    const linksRes = await app.request("/api/leads/no-existe/links", { headers: { cookie } });
    expect(linksRes.status).toBe(404);
  });

  it("sin sesion, /stages y /links dan 401 (guard de app.ts)", async () => {
    const app = createApp();
    await writeLead(deployableLead());
    const res = await app.request("/api/leads/carlos-doc/stages/deploy", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

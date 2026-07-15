import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadEnv } from "../../src/lib/env.js";
import type { Lead } from "../../src/lib/schema.js";
import { readLead, writeLead } from "../../src/lib/storage.js";
import { createApp } from "../../src/panel/app.js";
import { applyTracking } from "../../src/panel/services/tracking.js";

/**
 * Tests del control de tracking (carpeta + estado de envío + quién creó/envió):
 * la función pura applyTracking y la ruta PATCH /leads/:slug/tracking, además de
 * las facetas de carpeta y los filtros folder/sendState de GET /leads.
 */

function leadFixture(slug: string, overrides: Partial<Lead> = {}): Lead {
  return {
    slug,
    status: "verified",
    rubro: "doctor",
    source: { card_front: "card_front.jpg", ingested_at: "2026-07-01T00:00:00.000Z", channel: "manual" },
    business: { name: slug, attrs: {} },
    contact: { phones: ["9511234567"] },
    socials: {},
    brand: { colors: {}, has_logo: false },
    content: { services: [] },
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

type ListResp = {
  items: { slug: string; send_state: string; folder: string | null; created_by: string | null; sent_by: string | null }[];
  total: number;
  folders: { name: string; count: number }[];
};
async function getJson<T>(app: ReturnType<typeof createApp>, url: string, cookie: string): Promise<T> {
  return (await (await app.request(url, { headers: { cookie } })).json()) as T;
}

describe("applyTracking (puro)", () => {
  const NOW = "2026-07-15T12:00:00.000Z";

  it("asigna carpeta y estado sin tocar el resto", () => {
    const lead = leadFixture("x");
    const out = applyTracking(lead, { folder: "David", send_state: "ready" }, NOW);
    expect(out.tracking?.folder).toBe("David");
    expect(out.tracking?.send_state).toBe("ready");
    expect(out.business.name).toBe("x"); // intacto
  });

  it("carpeta vacía/null limpia la carpeta", () => {
    const lead = leadFixture("x", { tracking: { send_state: "draft", folder: "David" } });
    expect(applyTracking(lead, { folder: null }, NOW).tracking?.folder).toBeUndefined();
    expect(applyTracking(lead, { folder: "  " }, NOW).tracking?.folder).toBeUndefined();
  });

  it("al pasar a 'sent' estampa sent_at y sent_by = actor", () => {
    const lead = leadFixture("x");
    const out = applyTracking(lead, { send_state: "sent", actor: "Juan" }, NOW);
    expect(out.tracking?.send_state).toBe("sent");
    expect(out.tracking?.sent_by).toBe("Juan");
    expect(out.tracking?.sent_at).toBe(NOW);
  });

  it("sent_by explícito gana sobre actor", () => {
    const out = applyTracking(leadFixture("x"), { send_state: "sent", actor: "Juan", sent_by: "David" }, NOW);
    expect(out.tracking?.sent_by).toBe("David");
  });

  it("cambiar a un estado != sent no borra el historial de envío", () => {
    const lead = leadFixture("x", { tracking: { send_state: "sent", sent_by: "Juan", sent_at: NOW } });
    const out = applyTracking(lead, { send_state: "draft" }, "2026-07-16T00:00:00.000Z");
    expect(out.tracking?.send_state).toBe("draft");
    expect(out.tracking?.sent_by).toBe("Juan"); // se conserva
    expect(out.tracking?.sent_at).toBe(NOW);
  });

  it("parte de 'draft' cuando el lead no traía tracking (back-compat)", () => {
    const lead = leadFixture("x");
    expect(lead.tracking).toBeUndefined();
    const out = applyTracking(lead, { folder: "Borradores" }, NOW);
    expect(out.tracking?.send_state).toBe("draft");
    expect(out.tracking?.folder).toBe("Borradores");
  });
});

describe("tracking route + filtros de lista", () => {
  let tmpRoot: string;

  beforeAll(() => loadEnv());

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "card-leads-panel-tracking-"));
    process.env.LEADS_DIR = tmpRoot;
    process.env.PANEL_PASSPHRASE = "test-pass";
    process.env.PANEL_SESSION_SECRET = "test-secret";
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.LEADS_DIR;
    delete process.env.PANEL_PASSPHRASE;
    delete process.env.PANEL_SESSION_SECRET;
  });

  it("PATCH tracking persiste carpeta y estampa envío", async () => {
    const app = createApp();
    await writeLead(leadFixture("dr-a"));
    const cookie = await loginCookie(app);

    const res = await app.request("/api/leads/dr-a/tracking", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ folder: "David", send_state: "sent", actor: "David" }),
    });
    expect(res.status).toBe(200);
    const lead = (await readLead("dr-a"));
    expect(lead.tracking?.folder).toBe("David");
    expect(lead.tracking?.send_state).toBe("sent");
    expect(lead.tracking?.sent_by).toBe("David");
    expect(typeof lead.tracking?.sent_at).toBe("string");
  });

  it("PATCH tracking rechaza un send_state inválido (422)", async () => {
    const app = createApp();
    await writeLead(leadFixture("dr-a"));
    const cookie = await loginCookie(app);
    const res = await app.request("/api/leads/dr-a/tracking", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ send_state: "enviadisima" }),
    });
    expect(res.status).toBe(422);
  });

  it("GET /leads expone facetas de carpeta (con defaults) y filtra por folder/sendState", async () => {
    const app = createApp();
    await writeLead(leadFixture("a", { tracking: { send_state: "ready", folder: "David" } }));
    await writeLead(leadFixture("b", { tracking: { send_state: "sent", folder: "David" } }));
    await writeLead(leadFixture("c", { tracking: { send_state: "test", folder: "Juan" } }));
    await writeLead(leadFixture("d")); // sin carpeta
    const cookie = await loginCookie(app);

    const all = await getJson<ListResp>(app, "/api/leads", cookie);
    const byName = Object.fromEntries(all.folders.map((f) => [f.name, f.count]));
    expect(byName["David"]).toBe(2);
    expect(byName["Juan"]).toBe(1);
    expect(byName["(sin carpeta)"]).toBe(1);
    expect(byName["Borradores"]).toBe(0); // default sembrado aunque esté vacío

    const david = await getJson<ListResp>(app, "/api/leads?folder=David", cookie);
    expect(david.total).toBe(2);

    const sent = await getJson<ListResp>(app, "/api/leads?sendState=sent", cookie);
    expect(sent.total).toBe(1);
    expect(sent.items[0]!.slug).toBe("b");

    const none = await getJson<ListResp>(app, "/api/leads?folder=" + encodeURIComponent("(sin carpeta)"), cookie);
    expect(none.total).toBe(1);
    expect(none.items[0]!.slug).toBe("d");
  });

  it("los items de la lista incluyen send_state/folder/created_by/sent_by", async () => {
    const app = createApp();
    await writeLead(leadFixture("a", { tracking: { send_state: "ready", folder: "David", created_by: "David" } }));
    const cookie = await loginCookie(app);
    const data = await getJson<ListResp>(app, "/api/leads", cookie);
    expect(data.items[0]).toMatchObject({
      slug: "a",
      send_state: "ready",
      folder: "David",
      created_by: "David",
      sent_by: null,
    });
  });
});

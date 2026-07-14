import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadEnv } from "../../src/lib/env.js";
import type { Lead } from "../../src/lib/schema.js";
import { leadExists, writeLead } from "../../src/lib/storage.js";
import { createApp } from "../../src/panel/app.js";

/**
 * Tests de la ruta de leads: la lista paginada + filtrada (GET /leads) y el
 * borrado (DELETE /leads/:slug). Se monta la app real con createApp() y se
 * apunta LEADS_DIR a un tmp dir aislado; los leads se siembran con writeLead
 * directo (no se toca la red ni el pipeline).
 */

function leadFixture(slug: string, overrides: Partial<Lead> = {}): Lead {
  return {
    slug,
    status: "extracted",
    rubro: "doctor",
    source: {
      card_front: "card_front.jpg",
      ingested_at: "2026-07-01T00:00:00.000Z",
      channel: "manual",
    },
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

type ListResponse = {
  items: { slug: string; name: string; rubro: string; status: string }[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

describe("leads route — lista paginada + borrado", () => {
  let tmpRoot: string;

  beforeAll(() => {
    loadEnv();
  });

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "card-leads-panel-leads-"));
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

  it("GET /leads devuelve la forma paginada aun sin ningun lead", async () => {
    const app = createApp();
    const cookie = await loginCookie(app);
    const res = await app.request("/api/leads", { headers: { cookie } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as ListResponse;
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("GET /leads pagina con page y pageSize (sin solapar ni perder items)", async () => {
    const app = createApp();
    for (let i = 0; i < 25; i++) {
      await writeLead(leadFixture(`lead-${String(i).padStart(2, "0")}`));
    }
    const cookie = await loginCookie(app);

    const page1 = (await (await app.request("/api/leads?page=1&pageSize=10", { headers: { cookie } })).json()) as ListResponse;
    expect(page1.total).toBe(25);
    expect(page1.totalPages).toBe(3);
    expect(page1.pageSize).toBe(10);
    expect(page1.items).toHaveLength(10);

    const page2 = (await (await app.request("/api/leads?page=2&pageSize=10", { headers: { cookie } })).json()) as ListResponse;
    expect(page2.items).toHaveLength(10);

    const page3 = (await (await app.request("/api/leads?page=3&pageSize=10", { headers: { cookie } })).json()) as ListResponse;
    expect(page3.items).toHaveLength(5);

    // Las 3 paginas juntas cubren los 25 leads sin repetir ninguno.
    const allSlugs = [...page1.items, ...page2.items, ...page3.items].map((l) => l.slug);
    expect(new Set(allSlugs).size).toBe(25);

    // page fuera de rango se clampa a la ultima pagina valida.
    const overflow = (await (await app.request("/api/leads?page=99&pageSize=10", { headers: { cookie } })).json()) as ListResponse;
    expect(overflow.page).toBe(3);
    expect(overflow.items).toHaveLength(5);
  });

  it("GET /leads filtra por q en nombre/rubro/slug", async () => {
    const app = createApp();
    await writeLead(leadFixture("clinica-lopez", { business: { name: "Clinica Lopez", attrs: {} } }));
    await writeLead(leadFixture("barber-juan", { rubro: "barberia", business: { name: "Barber Juan", attrs: {} } }));
    const cookie = await loginCookie(app);

    const byName = (await (await app.request("/api/leads?q=lopez", { headers: { cookie } })).json()) as ListResponse;
    expect(byName.total).toBe(1);
    expect(byName.items[0]!.slug).toBe("clinica-lopez");

    const byRubro = (await (await app.request("/api/leads?q=barber", { headers: { cookie } })).json()) as ListResponse;
    expect(byRubro.total).toBe(1);
    expect(byRubro.items[0]!.slug).toBe("barber-juan");

    const none = (await (await app.request("/api/leads?q=zzz", { headers: { cookie } })).json()) as ListResponse;
    expect(none.total).toBe(0);
  });

  it("DELETE /leads/:slug borra el lead y ya no aparece en la lista", async () => {
    const app = createApp();
    await writeLead(leadFixture("carlos-doc"));
    const cookie = await loginCookie(app);
    expect(await leadExists("carlos-doc")).toBe(true);

    const del = await app.request("/api/leads/carlos-doc", { method: "DELETE", headers: { cookie } });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true, slug: "carlos-doc" });
    expect(await leadExists("carlos-doc")).toBe(false);

    const list = (await (await app.request("/api/leads", { headers: { cookie } })).json()) as ListResponse;
    expect(list.total).toBe(0);
  });

  it("DELETE de un lead inexistente da 404; slug invalido da 400", async () => {
    const app = createApp();
    const cookie = await loginCookie(app);

    const missing = await app.request("/api/leads/no-existe", { method: "DELETE", headers: { cookie } });
    expect(missing.status).toBe(404);

    // Un slug no canonico (mayusculas/underscore) lo rechaza isValidSlug antes
    // de tocar disco -> 400, sin fugarse del leadsRoot.
    const invalid = await app.request("/api/leads/Bad_Slug", { method: "DELETE", headers: { cookie } });
    expect(invalid.status).toBe(400);
  });

  it("sin sesion, GET /leads y DELETE dan 401 (guard de app.ts)", async () => {
    const app = createApp();
    await writeLead(leadFixture("carlos-doc"));
    expect((await app.request("/api/leads")).status).toBe(401);
    expect((await app.request("/api/leads/carlos-doc", { method: "DELETE" })).status).toBe(401);
  });
});

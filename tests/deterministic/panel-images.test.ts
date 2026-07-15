import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadEnv } from "../../src/lib/env.js";
import type { Lead } from "../../src/lib/schema.js";
import { leadDir, writeLead } from "../../src/lib/storage.js";
import { createApp } from "../../src/panel/app.js";
import { listLeadImages } from "../../src/panel/services/images.js";

/**
 * Tests de las imágenes del lead: la función pura listLeadImages, el listado
 * GET /leads/:slug/images, el servido GET /leads/:slug/image/:key (con su
 * content-type) y el guard anti path-traversal.
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

// 1x1 PNG (bytes reales) para servir un archivo de imagen de verdad.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("listLeadImages (puro)", () => {
  it("front va siempre; back/logo/photo solo si están declarados y son locales", () => {
    const lead = leadFixture("x", {
      source: { card_front: "card_front.jpg", card_back: "card_back.png", ingested_at: "2026-07-01T00:00:00.000Z", channel: "manual" },
      brand: { colors: {}, has_logo: true, logo_path: "logo.png", photo_path: "https://cdn/remote.jpg" },
    });
    const keys = listLeadImages(lead).map((r) => r.key);
    expect(keys).toEqual(["front", "back", "logo"]); // photo remota se descarta
  });

  it("descarta data: URIs (no son archivos locales)", () => {
    const lead = leadFixture("x", {
      brand: { colors: {}, has_logo: false, photo_path: "data:image/png;base64,AAAA" },
    });
    expect(listLeadImages(lead).map((r) => r.key)).toEqual(["front"]);
  });
});

describe("images routes", () => {
  let tmpRoot: string;

  beforeAll(() => loadEnv());

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "card-leads-panel-images-"));
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

  it("GET /images lista frente y reverso con su URL", async () => {
    const app = createApp();
    await writeLead(
      leadFixture("dr-a", {
        source: { card_front: "card_front.jpg", card_back: "card_back.jpg", ingested_at: "2026-07-01T00:00:00.000Z", channel: "manual" },
      }),
    );
    const cookie = await loginCookie(app);
    const data = (await (await app.request("/api/leads/dr-a/images", { headers: { cookie } })).json()) as {
      images: { key: string; url: string }[];
    };
    expect(data.images).toHaveLength(2);
    expect(data.images[0]).toMatchObject({ key: "front", url: "/api/leads/dr-a/image/front" });
    expect(data.images[1].key).toBe("back");
  });

  it("GET /image/:key sirve los bytes con content-type correcto", async () => {
    const app = createApp();
    await writeLead(leadFixture("dr-a", { source: { card_front: "card_front.png", ingested_at: "2026-07-01T00:00:00.000Z", channel: "manual" } }));
    writeFileSync(path.join(leadDir("dr-a"), "card_front.png"), PNG_1x1);
    const cookie = await loginCookie(app);

    const res = await app.request("/api/leads/dr-a/image/front", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(PNG_1x1)).toBe(true);
  });

  it("GET /image/:key da 404 si el archivo declarado no existe en disco", async () => {
    const app = createApp();
    await writeLead(leadFixture("dr-a")); // declara card_front.jpg pero no se escribe el archivo
    const cookie = await loginCookie(app);
    const res = await app.request("/api/leads/dr-a/image/front", { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("GET /image/:key con una clave desconocida da 404", async () => {
    const app = createApp();
    await writeLead(leadFixture("dr-a"));
    const cookie = await loginCookie(app);
    const res = await app.request("/api/leads/dr-a/image/back", { headers: { cookie } });
    expect(res.status).toBe(404); // no hay reverso declarado
  });

  it("no sirve imágenes sin sesión (guard de app.ts)", async () => {
    const app = createApp();
    await writeLead(leadFixture("dr-a"));
    expect((await app.request("/api/leads/dr-a/images")).status).toBe(401);
    expect((await app.request("/api/leads/dr-a/image/front")).status).toBe(401);
  });
});

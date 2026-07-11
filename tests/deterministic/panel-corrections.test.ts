import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLead, writeLead } from "../../src/lib/storage.js";
import type { Lead } from "../../src/lib/schema.js";
import {
  applyOneCorrection,
  correctField,
  CorrectionError,
  finalizeLeadVerification,
} from "../../src/panel/services/corrections.js";

/**
 * Tests deterministas del mapeo de correcciones del panel: es la unica logica
 * NUEVA no trivial (todo lo demas reusa applyCorrection/setAttr/finalizeVerified
 * de src/stages/verify.ts sin cambios). Cubre:
 * - applyOneCorrection (pura): dispatch "attr:<key>" -> setAttr vs
 *   LeadFieldPath -> applyCorrection, y los rechazos que deben ser 422.
 * - correctField / finalizeLeadVerification (con disco, LEADS_DIR temporal):
 *   load -> transform -> re-validate -> persist, y que un rechazo NO persiste.
 */

function extractedLead(overrides: Partial<Lead> = {}): Lead {
  return {
    slug: "carlos-doc",
    status: "extracted",
    rubro: "doctor",
    source: {
      card_front: "card_front.jpg",
      card_back: "card_back.jpg",
      ingested_at: "2026-07-03T00:00:00.000Z",
      channel: "manual",
    },
    business: { name: "Clinica X", person_name: "Dr. Carlos Perez", attrs: {} },
    contact: { phones: ["9511234567"] },
    socials: {},
    brand: { colors: { primary: "#4a2b2b" }, has_logo: false },
    content: { services: ["Consulta"] },
    generated: {},
    meta: { needs: ["falta email"], errors: [], updated_at: "2026-07-03T00:00:00.000Z" },
    ...overrides,
  };
}

describe("applyOneCorrection", () => {
  it("field plano (LeadFieldPath) delega en applyCorrection", () => {
    const lead = applyOneCorrection(extractedLead(), "contact.whatsapp", "+529511234567");
    expect(lead.contact.whatsapp).toBe("+529511234567");
  });

  it("lista con array delega en applyCorrection (normList)", () => {
    const lead = applyOneCorrection(extractedLead(), "contact.phones", ["9511234567", "9517654321"]);
    expect(lead.contact.phones).toEqual(["9511234567", "9517654321"]);
  });

  it('"attr:<key>" delega en setAttr y crea la credencial', () => {
    const lead = applyOneCorrection(extractedLead(), "attr:cedula", "12345678");
    expect(lead.business.attrs.cedula).toBe("12345678");
  });

  it('"attr:<key>" con value null BORRA la credencial (semantica de setAttr)', () => {
    const withAttr = applyOneCorrection(extractedLead(), "attr:cedula", "12345678");
    const cleared = applyOneCorrection(withAttr, "attr:cedula", null);
    expect(cleared.business.attrs.cedula).toBeUndefined();
  });

  it('"attr:" sin clave tira CorrectionError', () => {
    expect(() => applyOneCorrection(extractedLead(), "attr:", "x")).toThrow(CorrectionError);
  });

  it('"attr:<key>" con array tira CorrectionError (attrs son string|null, no lista)', () => {
    expect(() => applyOneCorrection(extractedLead(), "attr:cedula", ["a", "b"])).toThrow(CorrectionError);
  });

  it("field desconocido (no es LeadFieldPath ni attr:) tira CorrectionError", () => {
    expect(() => applyOneCorrection(extractedLead(), "business.slogan", "x")).toThrow(CorrectionError);
  });

  it("rubro invalido tira CorrectionError (envuelve el throw de applyCorrection)", () => {
    expect(() => applyOneCorrection(extractedLead(), "rubro", "panaderia")).toThrow(CorrectionError);
  });

  it("value: null limpia un campo opcional (delega la semantica de applyCorrection)", () => {
    const withTagline = applyOneCorrection(extractedLead(), "business.tagline", "Cardiologo");
    const cleared = applyOneCorrection(withTagline, "business.tagline", null);
    expect(cleared.business.tagline).toBeUndefined();
  });
});

describe("correctField / finalizeLeadVerification (con disco)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "card-leads-panel-corrections-"));
    process.env.LEADS_DIR = tmpRoot;
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.LEADS_DIR;
  });

  it("persiste la correccion y re-lee el mismo valor de disco", async () => {
    await writeLead(extractedLead());
    const updated = await correctField("carlos-doc", "contact.whatsapp", "+529511234567");
    expect(updated.contact.whatsapp).toBe("+529511234567");

    const reread = await readLead("carlos-doc");
    expect(reread.contact.whatsapp).toBe("+529511234567");
  });

  it("una correccion invalida (422) NO persiste nada", async () => {
    await writeLead(extractedLead());
    await expect(correctField("carlos-doc", "rubro", "panaderia")).rejects.toThrow(CorrectionError);

    const reread = await readLead("carlos-doc");
    expect(reread.rubro).toBe("doctor"); // sin cambios
  });

  it("finalizeLeadVerification pasa extracted -> verified y persiste colorsText recalculado", async () => {
    await writeLead(extractedLead());
    const finalized = await finalizeLeadVerification("carlos-doc");
    expect(finalized.status).toBe("verified");
    expect(finalized.brand.colorsText?.primary).toBeDefined();

    const reread = await readLead("carlos-doc");
    expect(reread.status).toBe("verified");
  });

  it("finalizeLeadVerification es idempotente si ya esta verified", async () => {
    await writeLead(extractedLead({ status: "verified" }));
    const result = await finalizeLeadVerification("carlos-doc");
    expect(result.status).toBe("verified");
  });

  it("finalizeLeadVerification tira si el status es anterior a extracted", async () => {
    await writeLead(extractedLead({ status: "ingested" }));
    await expect(finalizeLeadVerification("carlos-doc")).rejects.toThrow(CorrectionError);
  });
});

import { describe, expect, it } from "vitest";
import { LeadSchema, parseLead, type Lead } from "../../src/lib/schema.js";

/** Lead recien ingerido: campos vacios pero valido contra el schema. */
function ingestedLead(): Lead {
  return {
    slug: "barberia-el-corte",
    status: "ingested",
    rubro: "barberia",
    source: {
      card_front: "card_front.jpg",
      ingested_at: "2026-07-03T00:00:00.000Z",
      channel: "manual",
    },
    business: { name: "", attrs: {} },
    contact: {},
    socials: {},
    brand: { colors: {}, has_logo: false },
    content: { services: [] },
    generated: {},
    meta: { needs: ["extract"], errors: [], updated_at: "2026-07-03T00:00:00.000Z" },
  };
}

describe("LeadSchema", () => {
  it("acepta un lead recien ingerido (name vacio permitido)", () => {
    expect(() => parseLead(ingestedLead())).not.toThrow();
  });

  it("rechaza un status invalido", () => {
    const bad = { ...ingestedLead(), status: "publicado" };
    expect(LeadSchema.safeParse(bad).success).toBe(false);
  });

  it("rechaza un rubro invalido", () => {
    const bad = { ...ingestedLead(), rubro: "abogado" };
    expect(LeadSchema.safeParse(bad).success).toBe(false);
  });

  it("rechaza un slug vacio", () => {
    const bad = { ...ingestedLead(), slug: "" };
    expect(LeadSchema.safeParse(bad).success).toBe(false);
  });

  it("rechaza si falta un bloque requerido (source)", () => {
    const bad = { ...ingestedLead() } as Record<string, unknown>;
    delete bad.source;
    expect(LeadSchema.safeParse(bad).success).toBe(false);
  });

  it("rechaza attrs con valores no-string", () => {
    const bad = { ...ingestedLead(), business: { name: "X", attrs: { a: 1 } } };
    expect(LeadSchema.safeParse(bad).success).toBe(false);
  });
});

describe("migracion legacy phone -> phones", () => {
  it("un data.json viejo con contact.phone (string) no revienta y se migra a phones[]", () => {
    const legacy = { ...ingestedLead(), contact: { phone: "951 544 21 92" } };
    const lead = parseLead(legacy);
    expect(lead.contact.phones).toEqual(["951 544 21 92"]);
    // el campo legacy ya no existe en el objeto validado
    expect((lead.contact as Record<string, unknown>).phone).toBeUndefined();
  });

  it("conserva otros campos de contact al migrar", () => {
    const legacy = { ...ingestedLead(), contact: { phone: "111", email: "a@b.mx" } };
    const lead = parseLead(legacy);
    expect(lead.contact.phones).toEqual(["111"]);
    expect(lead.contact.email).toBe("a@b.mx");
  });

  it("separa por coma un phone viejo con varios numeros apretados en un string", () => {
    const legacy = { ...ingestedLead(), contact: { phone: "9512442555, 9511007161, 9515215433" } };
    const lead = parseLead(legacy);
    expect(lead.contact.phones).toEqual(["9512442555", "9511007161", "9515215433"]);
  });

  it("no toca un lead que ya usa phones[] (idempotente)", () => {
    const modern = { ...ingestedLead(), contact: { phones: ["1", "2"] } };
    expect(parseLead(modern).contact.phones).toEqual(["1", "2"]);
  });

  it("un phone legacy vacio no deja phones basura", () => {
    const legacy = { ...ingestedLead(), contact: { phone: "" } };
    const lead = parseLead(legacy);
    expect(lead.contact.phones ?? []).toEqual([]);
  });
});

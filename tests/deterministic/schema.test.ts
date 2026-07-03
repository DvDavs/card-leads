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

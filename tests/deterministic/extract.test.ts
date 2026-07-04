import { describe, expect, it } from "vitest";
import { parseExtraction, type Extraction } from "../../src/lib/llm/extraction.js";
import { applyExtraction } from "../../src/stages/extract.js";
import { parseLead, type Lead } from "../../src/lib/schema.js";

/**
 * Estos tests son deterministas: NO llaman al modelo. Cubren las dos funciones
 * puras de la etapa — parseExtraction (validar la salida cruda) y applyExtraction
 * (mapearla sobre el Lead). La llamada real a Gemini se prueba a mano.
 */

/** Lead recien ingerido (vacio pero valido), con overrides para cada caso. */
function ingestedLead(overrides: Partial<Lead> = {}): Lead {
  return {
    slug: "foto",
    status: "ingested",
    rubro: "otro",
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
    ...overrides,
  };
}

/** JSON de ejemplo tal como lo devolveria el modelo: campos vistos + null en lo que no. */
const SAMPLE = {
  business: { name: "Barberia El Corte", person_name: "Juan Perez", tagline: "Estilo clasico" },
  rubro: "barberia",
  contact: {
    phones: ["55 1234 5678"],
    whatsapp: "+525512345678",
    email: "hola@elcorte.mx",
    address: "Av. Reforma 123, CDMX",
    website: null,
  },
  socials: { instagram: "https://instagram.com/elcorte", facebook: null, tiktok: null },
  brand: {
    colors: { primary: "#0A0A0A", secondary: "#C8A24B", accent: null },
    has_logo: true,
    font_hint: "display",
  },
  content: { services: ["Corte", "Barba", "Afeitado clasico"] },
};

/** Parsea el sample y devuelve la Extraction, fallando el test si el fixture es invalido. */
function parseOk(sample: unknown): Extraction {
  const r = parseExtraction(JSON.stringify(sample));
  if (!r.ok) throw new Error(`fixture invalido: ${r.error}`);
  return r.data;
}

describe("parseExtraction", () => {
  it("acepta el JSON valido del modelo", () => {
    const r = parseExtraction(JSON.stringify(SAMPLE));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.business?.name).toBe("Barberia El Corte");
  });

  it("tolera null en los campos que el modelo no vio", () => {
    const r = parseExtraction(JSON.stringify(SAMPLE));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.contact?.website ?? null).toBeNull();
  });

  it("desenvuelve ```json ... ``` si el modelo lo manda con fences", () => {
    const r = parseExtraction("```json\n" + JSON.stringify(SAMPLE) + "\n```");
    expect(r.ok).toBe(true);
  });

  it("descarta claves extra que el modelo invente", () => {
    const withExtra = { ...SAMPLE, hallucinated: "no deberia estar" };
    const r = parseExtraction(JSON.stringify(withExtra));
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as Record<string, unknown>).hallucinated).toBeUndefined();
  });

  it("falla (no lanza) si la respuesta no es JSON", () => {
    const r = parseExtraction("lo siento, no puedo leer la tarjeta");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no es JSON");
  });

  it("falla si un tipo no cumple el schema (has_logo como string)", () => {
    const bad = { ...SAMPLE, brand: { ...SAMPLE.brand, has_logo: "si" } };
    expect(parseExtraction(JSON.stringify(bad)).ok).toBe(false);
  });

  it("falla si rubro no esta en el enum", () => {
    const bad = { ...SAMPLE, rubro: "abogado" };
    expect(parseExtraction(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe("applyExtraction", () => {
  it("mapea los campos del modelo al Lead", () => {
    const lead = applyExtraction(ingestedLead(), parseOk(SAMPLE));
    expect(lead.business.name).toBe("Barberia El Corte");
    expect(lead.business.person_name).toBe("Juan Perez");
    expect(lead.business.tagline).toBe("Estilo clasico");
    expect(lead.contact.phones).toEqual(["55 1234 5678"]);
    expect(lead.contact.whatsapp).toBe("+525512345678");
    expect(lead.contact.email).toBe("hola@elcorte.mx");
    expect(lead.socials.instagram).toBe("https://instagram.com/elcorte");
    expect(lead.brand.colors.primary).toBe("#0A0A0A");
    expect(lead.brand.colors.secondary).toBe("#C8A24B");
    expect(lead.brand.has_logo).toBe(true);
    expect(lead.brand.font_hint).toBe("display");
    expect(lead.content.services).toEqual(["Corte", "Barba", "Afeitado clasico"]);
  });

  it("el resultado sigue siendo un Lead valido contra el schema", () => {
    const lead = applyExtraction(ingestedLead(), parseOk(SAMPLE));
    // writeLead re-valida antes de persistir; aca comprobamos que el mapeo no
    // rompe el schema (p.ej. no deja campos opcionales en null).
    expect(() => parseLead(lead)).not.toThrow();
  });

  it("corrige el rubro que se puso al ingerir", () => {
    const lead = applyExtraction(ingestedLead({ rubro: "otro" }), parseOk(SAMPLE));
    expect(lead.rubro).toBe("barberia");
  });

  it("no pisa un dato existente cuando el modelo manda null", () => {
    const base = ingestedLead({ contact: { phones: ["55 0000 0000"] } });
    const lead = applyExtraction(base, parseOk({ contact: { phones: null } }));
    expect(lead.contact.phones).toEqual(["55 0000 0000"]);
  });

  it("mapea varios telefonos como lista (consultorios con multiples numeros)", () => {
    const lead = applyExtraction(
      ingestedLead(),
      parseOk({ contact: { phones: ["951 111 11 11", "951 222 22 22"] } }),
    );
    expect(lead.contact.phones).toEqual(["951 111 11 11", "951 222 22 22"]);
  });

  it("omite el campo (no lo deja en null) cuando el modelo manda null y no habia dato", () => {
    const lead = applyExtraction(ingestedLead(), parseOk({ contact: { website: null } }));
    expect(lead.contact.website).toBeUndefined();
  });

  it("registra en needs lo que el modelo no vio", () => {
    const lead = applyExtraction(ingestedLead(), parseOk({ business: { name: "Solo Nombre" } }));
    const needs = lead.meta.needs.join(" | ");
    expect(needs).toContain("telefono");
    expect(needs).toContain("redes sociales");
    expect(needs).toContain("colores");
    expect(needs).toContain("servicios");
  });

  it("no reporta como faltante lo que si vino", () => {
    const needs = applyExtraction(ingestedLead(), parseOk(SAMPLE)).meta.needs.join(" | ");
    expect(needs).not.toContain("nombre del negocio");
    expect(needs).not.toContain("falta telefono");
  });

  it("deja siempre el checkpoint de revision humana en needs", () => {
    const needs = applyExtraction(ingestedLead(), parseOk(SAMPLE)).meta.needs.join(" | ");
    expect(needs).toContain("revision humana");
  });

  it("limpia errores previos cuando el mapeo tiene exito", () => {
    const base = ingestedLead({
      meta: { needs: [], errors: ["intento previo fallo"], updated_at: "x" },
    });
    const lead = applyExtraction(base, parseOk(SAMPLE));
    expect(lead.meta.errors).toEqual([]);
  });
});

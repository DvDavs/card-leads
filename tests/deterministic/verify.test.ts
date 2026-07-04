import { describe, expect, it } from "vitest";
import { applyCorrection, finalizeVerified, describeColor } from "../../src/stages/verify.js";
import { parseLead, type Lead } from "../../src/lib/schema.js";

/**
 * Tests deterministas de verify: cubren SOLO las funciones puras. El recorrido
 * de readline (I/O interactivo) no se testea a proposito.
 * - applyCorrection: dado lead + campo + valor => lead nuevo (sin mutar).
 * - finalizeVerified: cierra a "verified" y limpia meta.needs de lo resuelto.
 */

/** Lead ya extraido (status "extracted"), parecido al de anverso, con overrides. */
function extractedLead(overrides: Partial<Lead> = {}): Lead {
  return {
    slug: "anverso",
    status: "extracted",
    rubro: "doctor",
    source: {
      card_front: "card_front.jpg",
      card_back: "card_back.jpg",
      ingested_at: "2026-07-03T00:00:00.000Z",
      channel: "manual",
    },
    business: {
      name: "DR. GUILLERMO KAREY",
      person_name: "Dr. Guillermo Karey Perez Cortes",
      tagline: "Cardiologo Intervencionista",
      attrs: {},
    },
    contact: {
      phones: ["951 544 21 92"],
      address: "Torre Medica Universidad Piso 8, Oaxaca",
    },
    socials: {},
    brand: {
      colors: { primary: "#4A2B2B", secondary: "#F0F0F0", accent: "#60B0C0" },
      has_logo: true,
      font_hint: "serif",
    },
    content: { services: ["Cateterismo cardiaco", "Angioplastia con stent"] },
    generated: {},
    meta: {
      needs: ["falta email", "faltan redes sociales", "revision humana: validar datos y correr `verify`"],
      errors: [],
      updated_at: "2026-07-03T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("applyCorrection", () => {
  it("corrige un digito del telefono, lista con array (el fallo tipico del modelo barato)", () => {
    const lead = applyCorrection(extractedLead(), "contact.phones", ["951 544 21 93"]);
    expect(lead.contact.phones).toEqual(["951 544 21 93"]);
  });

  it("reemplaza la lista de telefonos con varios numeros separados por comas", () => {
    const lead = applyCorrection(extractedLead(), "contact.phones", "951 111 11 11, 951 222 22 22");
    expect(lead.contact.phones).toEqual(["951 111 11 11", "951 222 22 22"]);
  });

  it("vacia la lista de telefonos con null", () => {
    const lead = applyCorrection(extractedLead(), "contact.phones", null);
    expect(lead.contact.phones).toEqual([]);
  });

  it("recorta el valor entrante de un campo string", () => {
    const lead = applyCorrection(extractedLead(), "contact.whatsapp", "  +529515442192  ");
    expect(lead.contact.whatsapp).toBe("+529515442192");
  });

  it("setea un handle de red social que estaba vacio", () => {
    const lead = applyCorrection(extractedLead(), "socials.instagram", "@drkarey");
    expect(lead.socials.instagram).toBe("@drkarey");
  });

  it("setea el whatsapp que no venia (WhatsApp sigue siendo uno solo)", () => {
    const lead = applyCorrection(extractedLead(), "contact.whatsapp", "+529515442192");
    expect(lead.contact.whatsapp).toBe("+529515442192");
  });

  it("corrige un color (hex aproximado del modelo)", () => {
    const lead = applyCorrection(extractedLead(), "brand.colors.primary", "#3A1F1F");
    expect(lead.brand.colors.primary).toBe("#3A1F1F");
  });

  it("vacia un campo opcional con null (queda undefined, no en null)", () => {
    const lead = applyCorrection(extractedLead(), "contact.whatsapp", null);
    expect(lead.contact.whatsapp).toBeUndefined();
  });

  it("vacia business.name (requerido) dejandolo en cadena vacia, no undefined", () => {
    const lead = applyCorrection(extractedLead(), "business.name", null);
    expect(lead.business.name).toBe("");
  });

  it("cambia el rubro a un valor valido del enum", () => {
    const lead = applyCorrection(extractedLead({ rubro: "otro" }), "rubro", "barberia");
    expect(lead.rubro).toBe("barberia");
  });

  it("lanza si el rubro esta fuera del enum (el caller re-pregunta)", () => {
    expect(() => applyCorrection(extractedLead(), "rubro", "abogado")).toThrow();
  });

  it("reemplaza la lista de servicios entera (array)", () => {
    const lead = applyCorrection(extractedLead(), "content.services", ["Corte", "Barba"]);
    expect(lead.content.services).toEqual(["Corte", "Barba"]);
  });

  it("acepta la lista de servicios como string separado por comas", () => {
    const lead = applyCorrection(extractedLead(), "content.services", "Corte, Barba , Afeitado");
    expect(lead.content.services).toEqual(["Corte", "Barba", "Afeitado"]);
  });

  it("vacia la lista de servicios con null", () => {
    const lead = applyCorrection(extractedLead(), "content.services", null);
    expect(lead.content.services).toEqual([]);
  });

  it("NO muta el lead de entrada (inmutable)", () => {
    const base = extractedLead();
    const before = JSON.parse(JSON.stringify(base));
    applyCorrection(base, "contact.phones", ["999"]);
    expect(base).toEqual(before);
  });

  it("el resultado sigue siendo un Lead valido contra el schema", () => {
    const lead = applyCorrection(extractedLead(), "contact.email", "hola@karey.mx");
    expect(() => parseLead(lead)).not.toThrow();
  });
});

describe("finalizeVerified", () => {
  it("avanza el status a 'verified'", () => {
    const lead = finalizeVerified(extractedLead());
    expect(lead.status).toBe("verified");
  });

  it("quita 'falta email' de needs cuando ya se cargo email", () => {
    const withEmail = applyCorrection(extractedLead(), "contact.email", "hola@karey.mx");
    const needs = finalizeVerified(withEmail).meta.needs.join(" | ");
    expect(needs).not.toContain("email");
  });

  it("limpia los pasos de proceso (deja de pedir 'revision humana / verify')", () => {
    const needs = finalizeVerified(extractedLead()).meta.needs.join(" | ");
    expect(needs).not.toContain("revision humana");
    expect(needs).not.toContain("verify");
  });

  it("mantiene en needs lo que sigue faltando (redes sociales)", () => {
    const needs = finalizeVerified(extractedLead()).meta.needs.join(" | ");
    expect(needs).toContain("redes sociales");
  });

  it("sin huecos, needs queda vacio", () => {
    let lead = extractedLead();
    lead = applyCorrection(lead, "contact.email", "hola@karey.mx");
    lead = applyCorrection(lead, "socials.instagram", "@drkarey");
    const final = finalizeVerified(lead);
    expect(final.meta.needs).toEqual([]);
  });

  it("el lead finalizado valida contra el schema estricto", () => {
    const lead = finalizeVerified(extractedLead());
    expect(() => parseLead(lead)).not.toThrow();
  });
});

describe("describeColor", () => {
  // Regresion del bug reportado: la version RGB-nearest etiquetaba estos como
  // "marron". El nombre no debe MENTIR.
  it("clasifica un morado oscuro como morado (no marron)", () => {
    expect(describeColor("#4A0A4A")).toBe("morado");
  });

  it("clasifica un azul marino como azul (no marron)", () => {
    expect(describeColor("#2C2C54")).toBe("azul");
  });

  it("clasifica colores primarios correctamente", () => {
    expect(describeColor("#FF0000")).toBe("rojo");
    expect(describeColor("#00FF00")).toBe("verde");
    expect(describeColor("#0000FF")).toBe("azul");
  });

  it("reconoce acromaticos por brillo", () => {
    expect(describeColor("#000000")).toBe("negro");
    expect(describeColor("#FFFFFF")).toBe("blanco");
    expect(describeColor("#808080")).toBe("gris");
  });

  it("marron solo para calidos oscuros de verdad", () => {
    expect(describeColor("#7A4A20")).toBe("marron"); // naranja oscuro = marron
    expect(describeColor("#E67822")).toBe("naranja"); // naranja brillante NO es marron
  });

  it("tolera hex sin '#' y devuelve undefined si no es hex de 6 digitos", () => {
    expect(describeColor("4A0A4A")).toBe("morado");
    expect(describeColor("no-hex")).toBeUndefined();
    expect(describeColor(undefined)).toBeUndefined();
  });
});

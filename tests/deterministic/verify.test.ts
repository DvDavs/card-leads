import { describe, expect, it } from "vitest";
import { applyCorrection, finalizeVerified, setAttr } from "../../src/stages/verify.js";
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

  it("re-deriva colorsText de los hex (incluye correcciones hechas a mano)", () => {
    // el humano corrigio primary a un color CLARO: su textColor debe ser negro.
    const corrected = applyCorrection(extractedLead(), "brand.colors.primary", "#e5e9ee");
    const final = finalizeVerified(corrected);
    expect(final.brand.colorsText?.primary).toBe("#000000"); // texto negro sobre claro
    expect(final.brand.colorsText?.accent).toBe("#000000"); // #60B0C0 es claro
  });

  it("omite del colorsText un color que no es hex valido (no rompe)", () => {
    const named = applyCorrection(extractedLead(), "brand.colors.primary", "azul");
    const final = finalizeVerified(named);
    expect(final.brand.colorsText?.primary).toBeUndefined();
  });
});

describe("setAttr (credenciales en business.attrs)", () => {
  it("setea una credencial nueva (recortada)", () => {
    const lead = setAttr(extractedLead(), "Cédula profesional", "  12007041  ");
    expect(lead.business.attrs["Cédula profesional"]).toBe("12007041");
  });

  it("actualiza una credencial existente (cedula mal transcrita por el modelo)", () => {
    const base = extractedLead({
      business: { name: "X", attrs: { "Cédula profesional": "12007040" } },
    });
    const lead = setAttr(base, "Cédula profesional", "12007041");
    expect(lead.business.attrs["Cédula profesional"]).toBe("12007041");
  });

  it("borra la credencial con null (queda fuera del mapa)", () => {
    const base = extractedLead({
      business: { name: "X", attrs: { "Cédula profesional": "12007041" } },
    });
    const lead = setAttr(base, "Cédula profesional", null);
    expect(lead.business.attrs["Cédula profesional"]).toBeUndefined();
    expect(Object.keys(lead.business.attrs)).toHaveLength(0);
  });

  it("NO muta el lead de entrada (inmutable)", () => {
    const base = extractedLead({ business: { name: "X", attrs: { Universidad: "UNAM" } } });
    const before = JSON.parse(JSON.stringify(base));
    setAttr(base, "Universidad", "UABJO");
    expect(base).toEqual(before);
  });

  it("el resultado sigue siendo un Lead valido contra el schema", () => {
    const lead = setAttr(extractedLead(), "Certificación", "Consejo Mexicano de Medicina Interna");
    expect(() => parseLead(lead)).not.toThrow();
  });
});

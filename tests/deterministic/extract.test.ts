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
  // el modelo YA NO devuelve colores: se miden con colorthief (ver colors.test.ts).
  brand: {
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

  it("acepta person_gender 'm'/'f' o null en business", () => {
    const withGender = { ...SAMPLE, business: { ...SAMPLE.business, person_gender: "m" } };
    const r = parseExtraction(JSON.stringify(withGender));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.business?.person_gender).toBe("m");
    const withNull = { ...SAMPLE, business: { ...SAMPLE.business, person_gender: null } };
    expect(parseExtraction(JSON.stringify(withNull)).ok).toBe(true);
  });

  it("falla si person_gender esta fuera del enum", () => {
    const bad = { ...SAMPLE, business: { ...SAMPLE.business, person_gender: "hombre" } };
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

  it("escribe los colores MEDIDOS (colorthief) en colors + colorsText", () => {
    const brandColors = {
      primary: { hex: "#24376d", textColor: "#ffffff" },
      accent: { hex: "#d1857c", textColor: "#000000" },
    };
    const lead = applyExtraction(ingestedLead(), parseOk(SAMPLE), brandColors);
    expect(lead.brand.colors.primary).toBe("#24376d");
    expect(lead.brand.colors.accent).toBe("#d1857c");
    expect(lead.brand.colorsText?.primary).toBe("#ffffff");
    expect(lead.brand.colorsText?.accent).toBe("#000000");
    // no se inventa un rol que colorthief no dio
    expect(lead.brand.colors.secondary).toBeUndefined();
    expect(lead.brand.colorsText?.secondary).toBeUndefined();
  });

  it("sin colores medidos, los deja vacios y lo anota como pendiente", () => {
    const lead = applyExtraction(ingestedLead(), parseOk(SAMPLE)); // brandColors default {}
    expect(lead.brand.colors.primary).toBeUndefined();
    expect(lead.meta.needs.join(" | ")).toContain("revisar colores en verify");
  });

  it("escribe los roles AMPLIADOS (background/text) y guarda la paleta medida", () => {
    const brandColors = {
      primary: { hex: "#24376d", textColor: "#ffffff" },
      background: { hex: "#fcfbf9", textColor: "#000000" },
      text: { hex: "#111111", textColor: "#ffffff" },
    };
    const palette = ["#24376d", "#fcfbf9", "#111111"];
    const lead = applyExtraction(ingestedLead(), parseOk(SAMPLE), brandColors, palette);
    expect(lead.brand.colors.background).toBe("#fcfbf9");
    expect(lead.brand.colors.text).toBe("#111111");
    expect(lead.brand.colorsText?.background).toBe("#000000");
    // 'text' es tinta (no superficie): el tipo de colorsText ni siquiera tiene la
    // clave. El cast comprueba en runtime que no se colo por otra via.
    expect((lead.brand.colorsText as Record<string, string | undefined>).text).toBeUndefined();
    // la paleta cruda queda persistida para verify y re-corridas
    expect(lead.brand.palette).toEqual(palette);
    expect(() => parseLead(lead)).not.toThrow();
  });

  it("los colores salen del param brandColors, NO de ex.colors (se resuelven en extract)", () => {
    // el LLM mando colors en la extraccion, pero applyExtraction no los lee:
    // la asignacion ya viene resuelta/validada en brandColors (default {} aca).
    const withColors = { ...SAMPLE, colors: { primary: "#123456" } };
    const lead = applyExtraction(ingestedLead(), parseOk(withColors));
    expect(lead.brand.colors.primary).toBeUndefined();
  });

  describe("person_gender (genero de la persona, para fotos de muestra en la web demo)", () => {
    it("mapea el genero que trajo el modelo", () => {
      const lead = applyExtraction(
        ingestedLead(),
        parseOk({ ...SAMPLE, business: { ...SAMPLE.business, person_gender: "m" } }),
      );
      expect(lead.business.person_gender).toBe("m");
      expect(() => parseLead(lead)).not.toThrow();
    });

    it("no pisa un genero ya cargado cuando el modelo manda null", () => {
      const base = ingestedLead({ business: { name: "", attrs: {}, person_gender: "f" } });
      const lead = applyExtraction(base, parseOk({ business: { person_gender: null } }));
      expect(lead.business.person_gender).toBe("f");
    });

    it("omite el campo (no lo deja en null) cuando el modelo manda null y no habia dato", () => {
      const lead = applyExtraction(ingestedLead(), parseOk({ business: { person_gender: null } }));
      expect(lead.business.person_gender).toBeUndefined();
    });

    it("anota en needs que el genero quedo sin confirmar cuando falta", () => {
      const lead = applyExtraction(ingestedLead(), parseOk(SAMPLE));
      expect(lead.meta.needs.join(" | ")).toContain("genero de la persona sin confirmar");
    });

    it("no anota el aviso de genero cuando el modelo si lo trajo", () => {
      const lead = applyExtraction(
        ingestedLead(),
        parseOk({ ...SAMPLE, business: { ...SAMPLE.business, person_gender: "f" } }),
      );
      expect(lead.meta.needs.join(" | ")).not.toContain("genero de la persona");
    });
  });

  describe("servicios por defecto (rubroConfig), cuando la tarjeta no los lista", () => {
    it("cae al default del rubro si el modelo no vio servicios", () => {
      const lead = applyExtraction(
        ingestedLead({ rubro: "veterinario" }),
        parseOk({ rubro: "veterinario", content: { services: [] } }),
      );
      expect(lead.content.services).toEqual(["Consulta", "Vacunacion", "Urgencias"]);
    });

    it("usa el rubro ya corregido por el modelo (no el original) para elegir el default", () => {
      // ingreso como "otro" pero el modelo detecta veterinario y no ve servicios:
      // el default debe salir del rubro FINAL, no del que traia el lead.
      const lead = applyExtraction(
        ingestedLead({ rubro: "otro" }),
        parseOk({ rubro: "veterinario", content: { services: [] } }),
      );
      expect(lead.rubro).toBe("veterinario");
      expect(lead.content.services).toEqual(["Consulta", "Vacunacion", "Urgencias"]);
    });

    it("NO pisa servicios reales leidos de la tarjeta con el default", () => {
      const lead = applyExtraction(
        ingestedLead({ rubro: "veterinario" }),
        parseOk({ rubro: "veterinario", content: { services: ["Peluqueria canina"] } }),
      );
      expect(lead.content.services).toEqual(["Peluqueria canina"]);
    });

    it("NO pisa servicios ya cargados en el lead (de una corrida previa) con el default", () => {
      const lead = applyExtraction(
        ingestedLead({ rubro: "veterinario", content: { services: ["Servicio ya cargado"] } }),
        parseOk({ rubro: "veterinario", content: { services: [] } }),
      );
      expect(lead.content.services).toEqual(["Servicio ya cargado"]);
    });

    it("rubro 'otro' no tiene default: queda vacio y se anota 'faltan servicios'", () => {
      const lead = applyExtraction(
        ingestedLead({ rubro: "otro" }),
        parseOk({ rubro: "otro", content: { services: [] } }),
      );
      expect(lead.content.services).toEqual([]);
      expect(lead.meta.needs.join(" | ")).toContain("faltan servicios");
    });

    it("anota en meta.needs que los servicios son sugeridos por rubro (no de la tarjeta)", () => {
      const lead = applyExtraction(
        ingestedLead({ rubro: "veterinario" }),
        parseOk({ rubro: "veterinario", content: { services: [] } }),
      );
      expect(lead.meta.needs.join(" | ")).toContain("servicios sugeridos por rubro");
    });

    it("no anota el aviso de 'sugeridos' cuando los servicios SI vinieron de la tarjeta", () => {
      const lead = applyExtraction(ingestedLead(), parseOk(SAMPLE));
      expect(lead.meta.needs.join(" | ")).not.toContain("servicios sugeridos por rubro");
    });
  });

  describe("credenciales medicas (business.attrs)", () => {
    it("parseExtraction NO falla si una cedula viene como number (z.any, se coacciona luego)", () => {
      // con z.string() por valor esto tiraria TODO el parse y se perderia la
      // extraccion entera; el schema tolerante lo acepta y lo arregla al mapear.
      const sample = {
        ...SAMPLE,
        business: { ...SAMPLE.business, attrs: { "Cédula profesional": 12007041 } },
      };
      expect(parseExtraction(JSON.stringify(sample)).ok).toBe(true);
    });

    it("mapea attrs: coacciona number a string, joinea listas y trimea", () => {
      const ex = parseOk({
        ...SAMPLE,
        rubro: "doctor",
        business: {
          ...SAMPLE.business,
          attrs: {
            "Cédula profesional": 12007041,
            "Cédula de especialidad": ["13937097", "14886103"],
            "Universidad": "  UNAM  ",
            vacio: "   ",
          },
        },
      });
      const lead = applyExtraction(ingestedLead({ rubro: "doctor" }), ex);
      expect(lead.business.attrs["Cédula profesional"]).toBe("12007041");
      expect(lead.business.attrs["Cédula de especialidad"]).toBe("13937097, 14886103");
      expect(lead.business.attrs["Universidad"]).toBe("UNAM");
      expect(lead.business.attrs.vacio).toBeUndefined(); // valor vacio se descarta
      expect(() => parseLead(lead)).not.toThrow();
    });

    it("fusiona: conserva attrs previos y el modelo agrega/actualiza por clave", () => {
      const base = ingestedLead({
        rubro: "doctor",
        business: { name: "", attrs: { Universidad: "UABJO" } },
      });
      const lead = applyExtraction(
        base,
        parseOk({ business: { attrs: { "Cédula profesional": "12007041" } } }),
      );
      expect(lead.business.attrs["Universidad"]).toBe("UABJO"); // conservado
      expect(lead.business.attrs["Cédula profesional"]).toBe("12007041"); // agregado
    });

    it("con credenciales, anota en needs que hay que VERIFICARLAS contra la tarjeta", () => {
      const lead = applyExtraction(
        ingestedLead({ rubro: "doctor" }),
        parseOk({ rubro: "doctor", business: { attrs: { "Cédula profesional": "12007041" } } }),
      );
      expect(lead.meta.needs.join(" | ")).toContain("credenciales capturadas");
    });

    it("doctor SIN credenciales: avisa que no se detectaron (posible lectura fallida)", () => {
      const lead = applyExtraction(
        ingestedLead({ rubro: "doctor" }),
        parseOk({ rubro: "doctor", business: { attrs: {} } }),
      );
      expect(lead.meta.needs.join(" | ")).toContain("sin credenciales detectadas");
    });

    it("rubro NO-doctor sin credenciales: attrs vacio y NINGUN aviso de credenciales", () => {
      const lead = applyExtraction(ingestedLead({ rubro: "barberia" }), parseOk(SAMPLE));
      expect(lead.business.attrs).toEqual({});
      expect(lead.meta.needs.join(" | ")).not.toContain("credenciales");
    });
  });
});

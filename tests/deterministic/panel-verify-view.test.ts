import { describe, expect, it } from "vitest";
import type { Lead } from "../../src/lib/schema.js";
import { buildVerifyView } from "../../src/panel/services/verify-view.js";
import { RISKY_FIELDS } from "../../src/stages/verify.js";

/**
 * Tests deterministas de verify-view: el contrato UI-ready que consume la
 * pantalla de verificacion del panel. Cubre el orden de riesgo (debe seguir
 * RISKY_FIELDS, la MISMA fuente que usa la verify() interactiva del CLI), el
 * calculo de rgb/textColor por color, y que attrs/palette pasen tal cual.
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
    business: {
      name: "Clinica X",
      person_name: "Dr. Carlos Perez",
      tagline: "Cardiologia",
      attrs: { cedula: "12345678" },
    },
    contact: { phones: ["9511234567"], whatsapp: "+529511234567", address: "Oaxaca" },
    socials: { facebook: "clinicax" },
    brand: {
      colors: { primary: "#4a2b2b", secondary: "#f0f0f0" },
      palette: ["#4a2b2b", "#f0f0f0", "#60b0c0"],
      has_logo: false,
    },
    content: { services: ["Consulta", "Cateterismo"] },
    generated: {},
    meta: { needs: ["falta email"], errors: [], updated_at: "2026-07-03T00:00:00.000Z" },
    ...overrides,
  };
}

describe("buildVerifyView", () => {
  it("phones va primero, aparte de riskyFirst/colors", () => {
    const view = buildVerifyView(extractedLead());
    expect(view.phones).toEqual({
      path: "contact.phones",
      label: "Telefonos",
      risky: true,
      kind: "list",
      value: ["9511234567"],
    });
  });

  it("riskyFirst sigue el orden de RISKY_FIELDS, EXCLUYENDO los de color", () => {
    const view = buildVerifyView(extractedLead());
    const expectedOrder = RISKY_FIELDS.filter((f) => !f.color).map((f) => f.path);
    expect(view.riskyFirst.map((f) => f.path)).toEqual(expectedOrder);
    expect(view.riskyFirst.every((f) => f.risky)).toBe(true);
  });

  it("colors sigue el orden de RISKY_FIELDS para los campos color:true", () => {
    const view = buildVerifyView(extractedLead());
    const expectedOrder = RISKY_FIELDS.filter((f) => f.color).map((f) => f.path.replace("brand.colors.", ""));
    expect(view.colors.map((c) => c.role)).toEqual(expectedOrder);
  });

  it("cada ColorField trae hex + rgb (via hexToRgb) + textColor + swatch", () => {
    const view = buildVerifyView(extractedLead());
    const primary = view.colors.find((c) => c.role === "primary")!;
    expect(primary.hex).toBe("#4a2b2b");
    expect(primary.rgb).toEqual({ r: 0x4a, g: 0x2b, b: 0x2b });
    expect(primary.textColor).toBeTruthy();
    expect(primary.swatch.background).toBe("#4a2b2b");
    expect(primary.swatch.color).toBe(primary.textColor);
  });

  it("un rol de color sin hex asignado da hex/rgb/textColor null (no rompe)", () => {
    const view = buildVerifyView(extractedLead());
    const text = view.colors.find((c) => c.role === "text")!;
    expect(text.hex).toBeNull();
    expect(text.rgb).toBeNull();
    expect(text.textColor).toBeNull();
  });

  it("attrs enumera business.attrs como {key,value,risky:true}", () => {
    const view = buildVerifyView(extractedLead());
    expect(view.attrs).toEqual([{ key: "cedula", value: "12345678", risky: true }]);
  });

  it("general trae name/person/gender/tagline/rubro/address/email en ese orden, con options en rubro/gender", () => {
    const view = buildVerifyView(extractedLead());
    expect(view.general.map((f) => f.path)).toEqual([
      "business.name",
      "business.person_name",
      "business.person_gender",
      "business.tagline",
      "rubro",
      "contact.address",
      "contact.email",
    ]);
    const rubroField = view.general.find((f) => f.path === "rubro")!;
    expect(rubroField.options).toContain("doctor");
    expect(rubroField.value).toBe("doctor");
  });

  it("services es una lista con los servicios actuales", () => {
    const view = buildVerifyView(extractedLead());
    expect(view.services).toEqual({
      path: "content.services",
      label: "Servicios",
      risky: false,
      kind: "list",
      value: ["Consulta", "Cateterismo"],
    });
  });

  it("palette y meta.needs pasan tal cual del Lead", () => {
    const view = buildVerifyView(extractedLead());
    expect(view.palette).toEqual(["#4a2b2b", "#f0f0f0", "#60b0c0"]);
    expect(view.meta.needs).toEqual(["falta email"]);
  });

  it("sin palette medida, palette es []", () => {
    const view = buildVerifyView(extractedLead({ brand: { colors: {}, has_logo: false } }));
    expect(view.palette).toEqual([]);
  });
});

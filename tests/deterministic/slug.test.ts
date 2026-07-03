import { describe, expect, it } from "vitest";
import { isValidSlug, slugFromFilename, slugify } from "../../src/lib/slug.js";

describe("slugify", () => {
  it("pasa a minusculas y usa guiones", () => {
    expect(slugify("Dr Perez")).toBe("dr-perez");
  });

  it("quita acentos y enies", () => {
    expect(slugify("Estética Niña")).toBe("estetica-nina");
  });

  it("colapsa separadores y simbolos en un solo guion", () => {
    expect(slugify("Dr. Pérez — Cardiólogo!!")).toBe("dr-perez-cardiologo");
  });

  it("recorta guiones de los bordes", () => {
    expect(slugify("  --Hola--  ")).toBe("hola");
  });

  it("es idempotente sobre un slug ya canonico", () => {
    const once = slugify("Barbería El Corte");
    expect(slugify(once)).toBe(once);
  });

  it("es determinista: misma entrada, misma salida", () => {
    const input = "Consultorio Médico San José";
    expect(slugify(input)).toBe(slugify(input));
    expect(slugify(input)).toBe("consultorio-medico-san-jose");
  });
});

describe("isValidSlug", () => {
  it("acepta kebab-case canonico", () => {
    expect(isValidSlug("dr-perez-cardiologo")).toBe(true);
  });

  it("rechaza mayusculas, espacios, guiones dobles y bordes", () => {
    expect(isValidSlug("Dr-Perez")).toBe(false);
    expect(isValidSlug("dr perez")).toBe(false);
    expect(isValidSlug("dr--perez")).toBe(false);
    expect(isValidSlug("-dr")).toBe(false);
    expect(isValidSlug("dr-")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });

  it("todo lo que produce slugify es un slug valido", () => {
    for (const s of ["Dr. Pérez — Cardiólogo", "Estética Niña", "  Hola  "]) {
      expect(isValidSlug(slugify(s))).toBe(true);
    }
  });
});

describe("slugFromFilename", () => {
  it("ignora carpetas y extension", () => {
    expect(slugFromFilename("C:/fotos/Dr Perez Frente.JPG")).toBe("dr-perez-frente");
    expect(slugFromFilename("/home/u/barberia-el-corte.png")).toBe("barberia-el-corte");
  });
});

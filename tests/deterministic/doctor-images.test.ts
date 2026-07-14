import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOCTOR_GENDERS,
  DOCTOR_IMAGE_MANIFEST,
  DOCTOR_SPECIALTIES,
  doctorImage,
  normalizeGender,
  normalizeSpecialty,
  officeImage,
  pickDoctorImage,
  pickOfficeImage,
} from "../../src/config/doctor-images.js";

/**
 * Tests deterministas del manifest de imagenes de plantillas web. Las rutas del
 * manifest apuntan a assets COMMITEADOS (SVG generados por
 * scripts/gen-template-images.mjs); el test aseveran que cada uno existe y es
 * un SVG valido, ademas de la logica pura de seleccion por genero/especialidad.
 */

/** Raiz del repo, resuelta contra este archivo (no contra el cwd). */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("manifest de imagenes", () => {
  it("cubre 4 especialidades x 3 generos + 4 consultorios = 16 assets", () => {
    expect(DOCTOR_SPECIALTIES).toHaveLength(4);
    expect(DOCTOR_GENDERS).toHaveLength(3);
    expect(DOCTOR_IMAGE_MANIFEST).toHaveLength(4 * 3 + 4);
  });

  it("cada ruta del manifest existe en disco y es un SVG valido", () => {
    for (const rel of DOCTOR_IMAGE_MANIFEST) {
      const abs = new URL(rel, `file://${REPO_ROOT}`).pathname;
      expect(existsSync(abs), `falta el asset ${rel}`).toBe(true);
      const svg = readFileSync(abs, "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    }
  });

  it("no tiene rutas duplicadas", () => {
    expect(new Set(DOCTOR_IMAGE_MANIFEST).size).toBe(DOCTOR_IMAGE_MANIFEST.length);
  });
});

describe("construccion de rutas", () => {
  it("doctorImage arma <especialidad>-<genero>", () => {
    expect(doctorImage("dental", "female")).toBe(
      "src/templates/assets/doctors/doctor-dental-female.svg",
    );
    expect(doctorImage("surgeon", "neutral")).toBe(
      "src/templates/assets/doctors/doctor-surgeon-neutral.svg",
    );
  });

  it("officeImage arma por especialidad", () => {
    expect(officeImage("aesthetic")).toBe("src/templates/assets/offices/office-aesthetic.svg");
  });
});

describe("normalizeSpecialty", () => {
  it("reconoce dental en español/inglés", () => {
    for (const s of ["dental", "Dentista", "odontología", "ortodoncia"]) {
      expect(normalizeSpecialty(s)).toBe("dental");
    }
  });
  it("reconoce cirujano", () => {
    for (const s of ["cirujano", "Cirugía plástica", "surgeon"]) {
      expect(normalizeSpecialty(s)).toBe("surgeon");
    }
  });
  it("reconoce estético", () => {
    for (const s of ["estético", "medicina estetica", "aesthetic", "dermatología"]) {
      expect(normalizeSpecialty(s)).toBe("aesthetic");
    }
  });
  it("cae a general cuando no reconoce (o vacío)", () => {
    expect(normalizeSpecialty("cardiología")).toBe("general");
    expect(normalizeSpecialty("")).toBe("general");
    expect(normalizeSpecialty(null)).toBe("general");
    expect(normalizeSpecialty(undefined)).toBe("general");
  });
});

describe("normalizeGender", () => {
  it("reconoce femenino", () => {
    for (const g of ["f", "Femenino", "mujer", "female", "Dra."]) {
      expect(normalizeGender(g)).toBe("female");
    }
  });
  it("reconoce masculino", () => {
    for (const g of ["m", "Masculino", "hombre", "male", "Dr"]) {
      expect(normalizeGender(g)).toBe("male");
    }
  });
  it("cae a neutral cuando no se sabe", () => {
    expect(normalizeGender("")).toBe("neutral");
    expect(normalizeGender(null)).toBe("neutral");
    expect(normalizeGender("no binario")).toBe("neutral");
  });
});

describe("seleccion por lead", () => {
  it("usa attrs.especialidad y attrs.genero cuando existen", () => {
    const lead = {
      rubro: "doctor" as const,
      business: { attrs: { especialidad: "dentista", genero: "mujer" } },
    };
    expect(pickDoctorImage(lead)).toBe(
      "src/templates/assets/doctors/doctor-dental-female.svg",
    );
    expect(pickOfficeImage(lead)).toBe("src/templates/assets/offices/office-dental.svg");
  });

  it("rubro doctor sin especialidad cae a general + genero neutral", () => {
    const lead = { rubro: "doctor" as const };
    expect(pickDoctorImage(lead)).toBe(
      "src/templates/assets/doctors/doctor-general-neutral.svg",
    );
    expect(pickOfficeImage(lead)).toBe("src/templates/assets/offices/office-general.svg");
  });

  it("rubro estetica cae a la especialidad aesthetic", () => {
    const lead = { rubro: "estetica" as const, business: { attrs: {} } };
    expect(pickDoctorImage(lead)).toBe(
      "src/templates/assets/doctors/doctor-aesthetic-neutral.svg",
    );
    expect(pickOfficeImage(lead)).toBe("src/templates/assets/offices/office-aesthetic.svg");
  });

  it("attrs.especialidad gana sobre el default del rubro", () => {
    const lead = {
      rubro: "estetica" as const,
      business: { attrs: { especialidad: "cirugía" } },
    };
    expect(pickDoctorImage(lead)).toBe(
      "src/templates/assets/doctors/doctor-surgeon-neutral.svg",
    );
  });
});

import type { Rubro } from "../lib/schema.js";

/**
 * doctor-images.ts — manifest + selector de imagenes placeholder para las
 * plantillas WEB (`src/templates/`).
 *
 * Contexto: el usuario pidio imagenes de doctores (hombre/mujer) y de
 * consultorios por tipo de doctor (dental, estetico, cirujano, medico
 * general). Como el entorno bloquea descargar fotos de stock y `CLAUDE.md`
 * prohibe generar caras/fotos falsas de personas, las imagenes son
 * ILUSTRACIONES SVG autocontenidas (pictogramas, sin rostro) generadas de
 * forma determinista por `scripts/gen-template-images.mjs`. Cuando haya fotos
 * reales con licencia, se dejan caer con el MISMO nombre de archivo y este
 * manifest las toma sin cambios de codigo.
 *
 * Este modulo es PURO (solo arma rutas POSIX relativas a la raiz del repo, no
 * lee disco). `build-web` (stub hoy) sera quien copie el asset elegido dentro
 * de `leads/<slug>/`, igual que `build-cards` espeja los assets de Guelaguetza.
 *
 * Los dos ejes que pidio el usuario:
 *  - GENERO del doctor: `neutral` | `female` | `male` (neutral = default seguro
 *    cuando no se sabe; ver guia de "they/them" por defecto).
 *  - ESPECIALIDAD / tipo de doctor: `general` | `dental` | `aesthetic` |
 *    `surgeon`. Define el consultorio y el acento/insignia del retrato.
 */

/** Especialidades soportadas (eje "tipo de doctor"). */
export const DOCTOR_SPECIALTIES = ["general", "dental", "aesthetic", "surgeon"] as const;
export type DoctorSpecialty = (typeof DOCTOR_SPECIALTIES)[number];

/** Generos soportados. `neutral` es el default cuando no se conoce el genero. */
export const DOCTOR_GENDERS = ["neutral", "female", "male"] as const;
export type DoctorGender = (typeof DOCTOR_GENDERS)[number];

/** Carpeta (relativa a la raiz del repo) donde viven los assets generados. */
const DOCTORS_DIR = "src/templates/assets/doctors";
const OFFICES_DIR = "src/templates/assets/offices";

/** Ruta al retrato de doctor para una especialidad + genero dados. */
export function doctorImage(specialty: DoctorSpecialty, gender: DoctorGender): string {
  return `${DOCTORS_DIR}/doctor-${specialty}-${gender}.svg`;
}

/** Ruta a la escena de consultorio para una especialidad dada. */
export function officeImage(specialty: DoctorSpecialty): string {
  return `${OFFICES_DIR}/office-${specialty}.svg`;
}

/**
 * DOCTOR_IMAGE_MANIFEST — lista COMPLETA de assets esperados (una entrada por
 * archivo). Lo consume el test para aseverar que cada ruta del manifest existe
 * realmente en disco, y sirve a `build-web` para saber que copiar.
 */
export const DOCTOR_IMAGE_MANIFEST: readonly string[] = [
  ...DOCTOR_SPECIALTIES.flatMap((s) => DOCTOR_GENDERS.map((g) => doctorImage(s, g))),
  ...DOCTOR_SPECIALTIES.map((s) => officeImage(s)),
];

// --- normalizacion de entradas crudas (attrs del lead, texto libre) --------

/**
 * Mapea texto libre (ej. `business.attrs.especialidad`, en español o inglés) a
 * una `DoctorSpecialty`. Default `general` cuando no reconoce el termino.
 */
export function normalizeSpecialty(raw?: string | null): DoctorSpecialty {
  const s = (raw ?? "").toLowerCase().trim();
  if (/(dental|dentist|odontolog|odontolog[íi]a|ortodon|endodon)/.test(s)) return "dental";
  if (/(cirug|cirujan|surgeon|surg|quir[úu]rg)/.test(s)) return "surgeon";
  if (/(est[ée]tic|cosmet|aesthetic|dermat|belleza|spa)/.test(s)) return "aesthetic";
  return "general";
}

/**
 * Mapea texto libre (ej. `business.attrs.genero`) a un `DoctorGender`. Default
 * `neutral` cuando no se puede determinar (no se infiere del nombre — un nombre
 * no dice el genero de una persona real).
 */
export function normalizeGender(raw?: string | null): DoctorGender {
  const g = (raw ?? "").toLowerCase().trim();
  if (/^(f|fem|femenino|femenina|mujer|female|dra\.?|doctora)$/.test(g)) return "female";
  if (/^(m|masc|masculino|masculina|hombre|male|dr\.?|doctor)$/.test(g)) return "male";
  return "neutral";
}

/** Especialidad por defecto segun rubro, si el lead no la especifica. */
function specialtyForRubro(rubro: Rubro): DoctorSpecialty {
  return rubro === "estetica" ? "aesthetic" : "general";
}

/**
 * Vista minima de un lead que necesita el selector — un subconjunto estructural
 * de `Lead`, para no acoplar el modulo a todo el schema. `business.attrs` es el
 * mapa libre por rubro (`especialidad`, `genero`).
 */
export interface DoctorImagePick {
  rubro: Rubro;
  business?: { attrs?: Record<string, string | undefined> | null } | null;
}

/**
 * Elige el retrato de doctor para un lead: toma `attrs.especialidad` /
 * `attrs.genero` si existen, cae a la especialidad del rubro y a genero
 * `neutral`. Es la puerta de entrada pensada para `build-web`.
 */
export function pickDoctorImage(lead: DoctorImagePick): string {
  const attrs = lead.business?.attrs ?? {};
  const specialty = attrs.especialidad
    ? normalizeSpecialty(attrs.especialidad)
    : specialtyForRubro(lead.rubro);
  const gender = normalizeGender(attrs.genero);
  return doctorImage(specialty, gender);
}

/** Elige la escena de consultorio para un lead (misma logica de especialidad). */
export function pickOfficeImage(lead: DoctorImagePick): string {
  const attrs = lead.business?.attrs ?? {};
  const specialty = attrs.especialidad
    ? normalizeSpecialty(attrs.especialidad)
    : specialtyForRubro(lead.rubro);
  return officeImage(specialty);
}

import { describe, expect, it } from "vitest";
import { parseEnrichment, type Enrichment } from "../../src/lib/llm/enrichment.js";
import { applyEnrichment, buildEnrichInput } from "../../src/stages/enrich.js";
import { parseLead, type Lead } from "../../src/lib/schema.js";

/**
 * Tests deterministas: NO llaman al modelo. Cubren las dos funciones puras de la
 * etapa — parseEnrichment (validar la salida cruda del LLM) y applyEnrichment
 * (fusionar el copy sobre el Lead). La llamada real a Gemini se prueba a mano.
 */

const NOW = "2026-07-09T00:00:00.000Z";

/** Lead verificado (valido) con overrides por caso. */
function verifiedLead(overrides: Partial<Lead> = {}): Lead {
  return {
    slug: "dr-karey",
    status: "verified",
    rubro: "doctor",
    source: {
      card_front: "card_front.jpg",
      ingested_at: "2026-07-03T00:00:00.000Z",
      channel: "manual",
    },
    business: { name: "Consultorio Karey", person_name: "Dra. Karey", attrs: {} },
    contact: { phones: ["951 111 1111"], address: "Oaxaca de Juarez" },
    socials: {},
    brand: { colors: {}, has_logo: false },
    content: { services: ["Consulta", "Estudios"] },
    generated: {},
    meta: { needs: ["revision humana: validar datos y correr `verify`"], errors: [], updated_at: NOW },
    ...overrides,
  };
}

/** JSON de ejemplo tal como lo devolveria el modelo de copy. */
const SAMPLE = {
  hero_headline: "Cuidamos tu salud con cercania",
  hero_subheadline: "Atencion medica integral y humana para toda la familia.",
  hero_badge: "Aceptando pacientes",
  bio: "La Dra. Karey acompana a sus pacientes con un trato cercano y claro, priorizando la prevencion y el seguimiento a lo largo del tiempo.",
  pull_quote: "Creo en explicar cada paso para que decidas con tranquilidad.",
  value_props: [
    { title: "Trato cercano", description: "Escuchamos antes de indicar." },
    { title: "Prevencion", description: "Detectar a tiempo cambia el pronostico." },
  ],
  service_descriptions: [
    { name: "Consulta", description: "Evaluacion completa y plan claro." },
    { name: "Estudios", description: "Solicitamos solo lo necesario." },
    { name: "Servicio Fantasma", description: "No existe en la lista real." },
  ],
  faqs: [
    { question: "Como agendo?", answer: "Por WhatsApp o telefono." },
    { question: "Primera visita?", answer: "Trae tus estudios previos." },
  ],
  testimonials: [
    { quote: "Excelente atencion.", author: "Paciente", role: null },
    { quote: "Muy clara al explicar.", author: "Maria G." },
  ],
  cta_headline: "Agenda tu consulta",
  cta_subtext: "Te contactamos para confirmar el horario.",
  footer_tagline: "Salud cercana y de confianza.",
  meta_title: "Consultorio Karey | Medicina familiar",
  meta_description: "Atencion medica integral y humana en Oaxaca.",
};

/** Bloque `demo` tal como lo devolveria el modelo (contenido FICTICIO de muestra). */
const SAMPLE_DEMO = {
  stats: [
    { value: "1,200+", label: "pacientes atendidos" },
    { value: "12 anos", label: "de trayectoria" },
    { value: "4.9", label: "calificacion promedio" },
    { value: "98%", label: "pacientes que regresan" },
  ],
  team: [
    { name: "Laura Mendoza", role: "Odontologa general", gender: "f" },
    { name: "Carlos Rios", role: "Higienista", gender: "m" },
    { name: "Ana Torres", role: "Recepcion", gender: "f" },
    { name: "Miguel Salas", role: "Asistente", gender: "m" },
    { name: "Sofia Vega", role: "Administracion", gender: "f" },
  ],
  experience: [
    {
      role: "Medica titular",
      place: "Consultorio propio",
      period: "2018 - Presente",
      description: "Atencion integral de pacientes.",
      current: true,
    },
    {
      role: "Medica adscrita",
      place: "Hospital General Regional",
      period: "2014 - 2018",
      description: "Consulta externa y seguimiento.",
      current: false,
    },
    {
      role: "Residente",
      place: "Centro de Salud Municipal",
      period: "2011 - 2014",
      description: "Formacion clinica supervisada.",
      current: false,
    },
  ],
  education: [
    {
      degree: "Medica Cirujana",
      institution: "Universidad Nacional",
      period: "2005 - 2011",
      details: ["Titulo profesional", "Servicio social comunitario"],
    },
    {
      degree: "Diplomado en medicina familiar",
      institution: "Instituto de Especialidades Medicas",
      period: "2012",
      details: ["Enfoque preventivo"],
    },
  ],
  research: [
    { tag: "Prevencion", title: "Habitos y salud familiar", description: "Educacion preventiva." },
    { tag: "Atencion primaria", title: "Seguimiento continuo", description: "Acompanamiento al paciente." },
  ],
  skills: ["Diagnostico", "Prevencion", "Seguimiento", "Comunicacion", "Urgencias menores", "Nutricion basica"],
  languages: [
    { language: "Espanol", level: "Nativo" },
    { language: "Ingles", level: "Intermedio" },
  ],
  mission: "Acompanar a cada paciente con atencion clara y humana.",
  patient_education: [
    { title: "Chequeo anual", description: "Detectar a tiempo cambia el pronostico." },
    { title: "Hidratacion", description: "Beber agua suficiente cada dia." },
    { title: "Descanso", description: "Dormir bien es parte del tratamiento." },
  ],
  sedation: {
    title: "Atencion sin dolor",
    description: "Opciones para pacientes con ansiedad.",
    points: ["Evaluacion previa", "Monitoreo continuo"],
  },
  hygiene: [
    { title: "Esterilizacion", description: "Instrumental esterilizado por paciente." },
    { title: "Desinfeccion", description: "Superficies limpias entre consultas." },
    { title: "Material desechable", description: "Un solo uso donde corresponde." },
  ],
  urgency: { headline: "Atencion el mismo dia", subtext: "Espacios reservados para urgencias." },
  availability_badge: "Agenda abierta",
  rating: { value: "4.9", count_label: "128 resenas" },
  trust_items: ["Atencion personalizada", "Equipo calificado", "Instalaciones limpias"],
};

/** Parsea el sample y devuelve la Enrichment, fallando el test si el fixture es invalido. */
function parseOk(sample: unknown): Enrichment {
  const r = parseEnrichment(JSON.stringify(sample));
  if (!r.ok) throw new Error(`fixture invalido: ${r.error}`);
  return r.data;
}

describe("parseEnrichment", () => {
  it("acepta el JSON valido del modelo", () => {
    const r = parseEnrichment(JSON.stringify(SAMPLE));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.hero_headline).toBe("Cuidamos tu salud con cercania");
  });

  it("desenvuelve ```json ... ``` si el modelo lo manda con fences", () => {
    const r = parseEnrichment("```json\n" + JSON.stringify(SAMPLE) + "\n```");
    expect(r.ok).toBe(true);
  });

  it("las listas ausentes caen a [] (generacion incompleta sigue usable)", () => {
    const partial = { ...SAMPLE };
    delete (partial as Record<string, unknown>).faqs;
    delete (partial as Record<string, unknown>).testimonials;
    const r = parseEnrichment(JSON.stringify(partial));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.faqs).toEqual([]);
      expect(r.data.testimonials).toEqual([]);
    }
  });

  it("descarta claves extra que el modelo invente (p.ej. stats)", () => {
    const withExtra = { ...SAMPLE, stats: [{ label: "Pacientes", value: "10K" }] };
    const r = parseEnrichment(JSON.stringify(withExtra));
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as Record<string, unknown>).stats).toBeUndefined();
  });

  it("falla (no lanza) si la respuesta no es JSON", () => {
    const r = parseEnrichment("claro, aca va tu copy...");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no es JSON");
  });

  it("falla si falta un campo narrativo requerido (hero_headline vacio)", () => {
    const bad = { ...SAMPLE, hero_headline: "" };
    expect(parseEnrichment(JSON.stringify(bad)).ok).toBe(false);
  });

  it("acepta el bloque demo completo", () => {
    const r = parseEnrichment(JSON.stringify({ ...SAMPLE, demo: SAMPLE_DEMO }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.demo?.stats).toHaveLength(4);
      expect(r.data.demo?.team[0]).toEqual({
        name: "Laura Mendoza",
        role: "Odontologa general",
        gender: "f",
      });
    }
  });

  it("back-compat: una respuesta SIN demo sigue parseando (demo queda undefined)", () => {
    // SAMPLE es la forma vieja del contrato (previa al bloque demo)
    const r = parseEnrichment(JSON.stringify(SAMPLE));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.demo).toBeUndefined();
  });

  it("demo parcial: las listas ausentes caen a [] y no tumban el parseo", () => {
    const partialDemo = { stats: SAMPLE_DEMO.stats, mission: "Cuidar de verdad." };
    const r = parseEnrichment(JSON.stringify({ ...SAMPLE, demo: partialDemo }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.demo?.stats).toHaveLength(4);
      expect(r.data.demo?.team).toEqual([]);
      expect(r.data.demo?.hygiene).toEqual([]);
      expect(r.data.demo?.sedation).toBeUndefined();
    }
  });

  it("demo con gender invalido en team falla el parseo (contrato estricto)", () => {
    const bad = {
      ...SAMPLE,
      demo: { team: [{ name: "Laura", role: "Recepcion", gender: "x" }] },
    };
    expect(parseEnrichment(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe("applyEnrichment", () => {
  it("escribe el bloque generated_copy separado de los datos reales", () => {
    const lead = applyEnrichment(verifiedLead(), parseOk(SAMPLE), NOW);
    const copy = lead.content.generated_copy;
    expect(copy).toBeDefined();
    expect(copy?.hero_headline).toBe("Cuidamos tu salud con cercania");
    expect(copy?.generated_at).toBe(NOW);
    // datos reales intactos
    expect(lead.business.name).toBe("Consultorio Karey");
    expect(lead.contact.phones).toEqual(["951 111 1111"]);
    expect(lead.content.services).toEqual(["Consulta", "Estudios"]);
  });

  it("el resultado sigue siendo un Lead valido contra el schema", () => {
    const lead = applyEnrichment(verifiedLead(), parseOk(SAMPLE), NOW);
    expect(() => parseLead(lead)).not.toThrow();
  });

  it("mapea descripciones SOLO a servicios reales (descarta las ajenas)", () => {
    const lead = applyEnrichment(verifiedLead(), parseOk(SAMPLE), NOW);
    const descs = lead.content.generated_copy!.service_descriptions;
    expect(descs.map((d) => d.name)).toEqual(["Consulta", "Estudios"]);
    // "Servicio Fantasma" no esta en content.services -> se descarta
    expect(descs.find((d) => d.name === "Servicio Fantasma")).toBeUndefined();
  });

  it("usa el nombre REAL del servicio (spelling de verify), no el del modelo", () => {
    const lead = applyEnrichment(
      verifiedLead({ content: { services: ["Consulta"] } }),
      parseOk({ ...SAMPLE, service_descriptions: [{ name: "  consulta ", description: "desc" }] }),
      NOW,
    );
    const descs = lead.content.generated_copy!.service_descriptions;
    expect(descs).toEqual([{ name: "Consulta", description: "desc" }]);
  });

  it("un servicio real sin descripcion del modelo simplemente no aparece", () => {
    const lead = applyEnrichment(
      verifiedLead({ content: { services: ["Consulta", "Estudios", "Cirugia"] } }),
      parseOk(SAMPLE), // el modelo solo describio Consulta y Estudios
      NOW,
    );
    const names = lead.content.generated_copy!.service_descriptions.map((d) => d.name);
    expect(names).toEqual(["Consulta", "Estudios"]);
  });

  it("marca los testimonios como EJEMPLO en sample_fields", () => {
    const lead = applyEnrichment(verifiedLead(), parseOk(SAMPLE), NOW);
    expect(lead.content.generated_copy!.sample_fields).toContain("testimonials");
    expect(lead.meta.needs.join(" | ")).toContain("testimonios de EJEMPLO");
  });

  it("convierte role null del testimonio en ausencia (no lo deja en null)", () => {
    const lead = applyEnrichment(verifiedLead(), parseOk(SAMPLE), NOW);
    const t = lead.content.generated_copy!.testimonials[0]!;
    expect(t.author).toBe("Paciente");
    expect((t as Record<string, unknown>).role).toBeUndefined();
  });

  it("rellena contact.hours con el default del rubro cuando falta y lo anota", () => {
    const lead = applyEnrichment(verifiedLead({ rubro: "barberia" }), parseOk(SAMPLE), NOW);
    expect(lead.contact.hours).toBe("Martes a Sabado 10:00-20:00");
    expect(lead.meta.needs.join(" | ")).toContain("horario sugerido por rubro");
  });

  it("NO pisa un horario real ya cargado en el lead", () => {
    const lead = applyEnrichment(
      verifiedLead({ contact: { phones: ["951 111 1111"], hours: "Lun-Vie 8-15" } }),
      parseOk(SAMPLE),
      NOW,
    );
    expect(lead.contact.hours).toBe("Lun-Vie 8-15");
    expect(lead.meta.needs.join(" | ")).not.toContain("horario sugerido por rubro");
  });

  it("los value props no traen numeros duros (stats descartados): se guardan tal cual", () => {
    const lead = applyEnrichment(verifiedLead(), parseOk(SAMPLE), NOW);
    expect(lead.content.generated_copy!.value_props).toHaveLength(2);
    expect(lead.content.generated_copy!.value_props[0]!.title).toBe("Trato cercano");
  });

  it("limpia errores previos y no cambia el status (eso lo hace la etapa)", () => {
    const base = verifiedLead({
      status: "linktree_built",
      meta: { needs: [], errors: ["intento previo fallo"], updated_at: NOW },
    });
    const lead = applyEnrichment(base, parseOk(SAMPLE), NOW);
    expect(lead.meta.errors).toEqual([]);
    expect(lead.status).toBe("linktree_built"); // applyEnrichment no toca status
  });

  it("es idempotente en meta.needs al re-correr (no duplica anotaciones de enrich)", () => {
    const once = applyEnrichment(verifiedLead(), parseOk(SAMPLE), NOW);
    const twice = applyEnrichment(once, parseOk(SAMPLE), NOW);
    const count = (n: string) => twice.meta.needs.filter((x) => x.startsWith(n)).length;
    expect(count("horario sugerido por rubro")).toBe(1);
    expect(count("testimonios de EJEMPLO")).toBe(1);
    expect(count("revisar copy generado")).toBe(1);
  });

  it("back-compat: un lead sin generated_copy valida contra el schema", () => {
    // un data.json previo a enrich (sin el bloque) debe seguir cargando
    expect(() => parseLead(verifiedLead())).not.toThrow();
    expect(verifiedLead().content.generated_copy).toBeUndefined();
  });

  it("fusiona el bloque demo en generated_copy.demo y sigue validando el schema", () => {
    const lead = applyEnrichment(verifiedLead(), parseOk({ ...SAMPLE, demo: SAMPLE_DEMO }), NOW);
    const demo = lead.content.generated_copy!.demo;
    expect(demo).toBeDefined();
    expect(demo?.stats).toHaveLength(4);
    expect(demo?.team).toHaveLength(5);
    expect(demo?.experience?.filter((e) => e.current)).toHaveLength(1);
    expect(demo?.mission).toBe("Acompanar a cada paciente con atencion clara y humana.");
    expect(demo?.rating).toEqual({ value: "4.9", count_label: "128 resenas" });
    expect(() => parseLead(lead)).not.toThrow();
  });

  it("marca el demo como EJEMPLO en sample_fields y anota el need", () => {
    const lead = applyEnrichment(verifiedLead(), parseOk({ ...SAMPLE, demo: SAMPLE_DEMO }), NOW);
    expect(lead.content.generated_copy!.sample_fields).toContain("demo");
    expect(lead.meta.needs.join(" | ")).toContain("contenido de DEMO generado");
  });

  it("'demo' aparece UNA sola vez en sample_fields y meta.needs aun al re-correr", () => {
    const withDemo = parseOk({ ...SAMPLE, demo: SAMPLE_DEMO });
    const once = applyEnrichment(verifiedLead(), withDemo, NOW);
    const twice = applyEnrichment(once, withDemo, NOW);
    const fields = twice.content.generated_copy!.sample_fields!;
    expect(fields.filter((f) => f === "demo")).toHaveLength(1);
    const needCount = twice.meta.needs.filter((n) =>
      n.startsWith("contenido de DEMO generado"),
    ).length;
    expect(needCount).toBe(1);
  });

  it("sin demo del modelo: ni generated_copy.demo, ni sample_field, ni need", () => {
    const lead = applyEnrichment(verifiedLead(), parseOk(SAMPLE), NOW);
    expect(lead.content.generated_copy!.demo).toBeUndefined();
    expect(lead.content.generated_copy!.sample_fields).not.toContain("demo");
    expect(lead.meta.needs.join(" | ")).not.toContain("contenido de DEMO generado");
  });

  it("re-correr SIN demo limpia el need de demo dejado por una corrida anterior", () => {
    const once = applyEnrichment(verifiedLead(), parseOk({ ...SAMPLE, demo: SAMPLE_DEMO }), NOW);
    const twice = applyEnrichment(once, parseOk(SAMPLE), NOW);
    expect(twice.meta.needs.join(" | ")).not.toContain("contenido de DEMO generado");
  });

  it("demo vacio (todas las listas []) se trata como ausente: no se persiste", () => {
    const lead = applyEnrichment(verifiedLead(), parseOk({ ...SAMPLE, demo: {} }), NOW);
    expect(lead.content.generated_copy!.demo).toBeUndefined();
    expect(lead.content.generated_copy!.sample_fields).not.toContain("demo");
  });
});

describe("buildEnrichInput", () => {
  it("pasa person_gender del lead como personGender", () => {
    const lead = verifiedLead({
      business: {
        name: "Consultorio Karey",
        person_name: "Dra. Karey",
        person_gender: "f",
        attrs: {},
      },
    });
    const input = buildEnrichInput(lead);
    expect(input.personGender).toBe("f");
    expect(input.personName).toBe("Dra. Karey");
    expect(input.rubro).toBe("doctor");
    expect(input.services).toEqual(["Consulta", "Estudios"]);
  });

  it("sin person_gender en el lead, personGender queda ausente (no null)", () => {
    const input = buildEnrichInput(verifiedLead());
    expect("personGender" in input).toBe(false);
  });
});

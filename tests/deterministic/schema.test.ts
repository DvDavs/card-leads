import { describe, expect, it } from "vitest";
import {
  DemoContentSchema,
  LeadSchema,
  parseLead,
  type GeneratedCopy,
  type Lead,
} from "../../src/lib/schema.js";

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

  it("acepta un lead SIN tracking (back-compat) y no lo inventa", () => {
    const parsed = parseLead(ingestedLead());
    expect(parsed.tracking).toBeUndefined();
  });

  it("si viene tracking sin send_state, cae a 'draft'; valida los estados", () => {
    const withTracking = { ...ingestedLead(), tracking: { folder: "David" } };
    expect(parseLead(withTracking).tracking?.send_state).toBe("draft");

    const badState = { ...ingestedLead(), tracking: { send_state: "enviadisima" } };
    expect(LeadSchema.safeParse(badState).success).toBe(false);
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

describe("migracion legacy phone -> phones", () => {
  it("un data.json viejo con contact.phone (string) no revienta y se migra a phones[]", () => {
    const legacy = { ...ingestedLead(), contact: { phone: "951 544 21 92" } };
    const lead = parseLead(legacy);
    expect(lead.contact.phones).toEqual(["951 544 21 92"]);
    // el campo legacy ya no existe en el objeto validado
    expect((lead.contact as Record<string, unknown>).phone).toBeUndefined();
  });

  it("conserva otros campos de contact al migrar", () => {
    const legacy = { ...ingestedLead(), contact: { phone: "111", email: "a@b.mx" } };
    const lead = parseLead(legacy);
    expect(lead.contact.phones).toEqual(["111"]);
    expect(lead.contact.email).toBe("a@b.mx");
  });

  it("separa por coma un phone viejo con varios numeros apretados en un string", () => {
    const legacy = { ...ingestedLead(), contact: { phone: "9512442555, 9511007161, 9515215433" } };
    const lead = parseLead(legacy);
    expect(lead.contact.phones).toEqual(["9512442555", "9511007161", "9515215433"]);
  });

  it("no toca un lead que ya usa phones[] (idempotente)", () => {
    const modern = { ...ingestedLead(), contact: { phones: ["1", "2"] } };
    expect(parseLead(modern).contact.phones).toEqual(["1", "2"]);
  });

  it("un phone legacy vacio no deja phones basura", () => {
    const legacy = { ...ingestedLead(), contact: { phone: "" } };
    const lead = parseLead(legacy);
    expect(lead.contact.phones ?? []).toEqual([]);
  });
});

describe("business.person_gender", () => {
  it("un data.json viejo SIN person_gender sigue validando (sin migracion)", () => {
    // ingestedLead no trae la clave: eso ES el caso legacy.
    const lead = parseLead(ingestedLead());
    expect(lead.business.person_gender).toBeUndefined();
  });

  it("acepta 'm' y 'f'", () => {
    for (const gender of ["m", "f"] as const) {
      const withGender = {
        ...ingestedLead(),
        business: { name: "X", attrs: {}, person_gender: gender },
      };
      expect(parseLead(withGender).business.person_gender).toBe(gender);
    }
  });

  it("rechaza un genero fuera del enum", () => {
    const bad = {
      ...ingestedLead(),
      business: { name: "X", attrs: {}, person_gender: "masculino" },
    };
    expect(LeadSchema.safeParse(bad).success).toBe(false);
  });
});

/** Copy generado minimo valido (solo los campos requeridos), con overrides. */
function generatedCopy(overrides: Partial<GeneratedCopy> = {}): GeneratedCopy {
  return {
    hero_headline: "Tu sonrisa en buenas manos",
    hero_subheadline: "Atencion cercana y sin dolor.",
    bio: "Mas de una decada cuidando pacientes.",
    value_props: [{ title: "Trato humano", description: "Te explicamos cada paso." }],
    service_descriptions: [{ name: "Corte", description: "Clasico o moderno." }],
    faqs: [{ question: "¿Aceptan urgencias?", answer: "Si, el mismo dia." }],
    testimonials: [{ quote: "Excelente atencion.", author: "Paciente" }],
    cta_headline: "Agenda tu cita",
    cta_subtext: "Respondemos por WhatsApp.",
    footer_tagline: "Cuidamos de ti.",
    generated_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("GeneratedCopySchema + demo (DemoContentSchema)", () => {
  it("un data.json viejo SIN generated_copy sigue validando (sin migracion)", () => {
    const lead = parseLead(ingestedLead());
    expect(lead.content.generated_copy).toBeUndefined();
  });

  it("acepta generated_copy SIN demo (copy generado antes de esta pieza)", () => {
    const lead = {
      ...ingestedLead(),
      content: { services: [], generated_copy: generatedCopy() },
    };
    expect(parseLead(lead).content.generated_copy?.demo).toBeUndefined();
  });

  it("el bloque demo COMPLETO hace round-trip por GeneratedCopy dentro del Lead", () => {
    const demo = {
      stats: [{ value: "+10", label: "anios de experiencia" }],
      team: [{ name: "Ana Lopez", role: "Higienista", gender: "f" as const }],
      experience: [
        {
          role: "Cirujano dentista",
          place: "Clinica Central",
          period: "2015 - actual",
          description: "Consulta general y cirugia.",
          current: true,
        },
      ],
      education: [
        {
          degree: "Cirujano Dentista",
          institution: "UNAM",
          period: "2008 - 2013",
          details: ["Mencion honorifica"],
        },
      ],
      research: [
        { tag: "Ortodoncia", title: "Alineadores", description: "Estudio comparativo." },
      ],
      skills: ["Endodoncia", "Estetica dental"],
      languages: [{ language: "Espanol", level: "Nativo" }],
      mission: "Devolver sonrisas sanas.",
      patient_education: [{ title: "Cepillado", description: "Tecnica correcta." }],
      sedation: {
        title: "Sedacion consciente",
        description: "Para pacientes con ansiedad.",
        points: ["Segura", "Supervisada"],
      },
      hygiene: [{ title: "Esterilizacion", description: "Instrumental sellado." }],
      urgency: { headline: "¿Dolor ahora?", subtext: "Te atendemos hoy." },
      availability_badge: "Aceptando pacientes",
      rating: { value: "4.9", count_label: "120 resenas" },
      trust_items: ["Cedula profesional", "Facturacion"],
    };
    const lead = {
      ...ingestedLead(),
      content: { services: [], generated_copy: generatedCopy({ demo }) },
    };
    // round-trip: parsear no pierde ni transforma ningun campo del demo
    expect(parseLead(lead).content.generated_copy?.demo).toEqual(demo);
  });

  it("demo vacio ({}) es valido: todos los campos son opcionales", () => {
    expect(DemoContentSchema.safeParse({}).success).toBe(true);
  });

  it("rechaza un gender invalido dentro de team", () => {
    const bad = { team: [{ name: "Ana", role: "Higienista", gender: "x" }] };
    expect(DemoContentSchema.safeParse(bad).success).toBe(false);
  });

  it("rechaza un stat sin label (la forma del bloque es fija)", () => {
    const bad = { stats: [{ value: "+10" }] };
    expect(DemoContentSchema.safeParse(bad).success).toBe(false);
  });
});

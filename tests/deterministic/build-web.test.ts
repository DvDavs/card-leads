import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertWebBuildableStatus,
  buildWebView,
  hoursAreReferential,
  webAssetSrc,
} from "../../src/stages/build-web.js";
import { renderTemplate } from "../../src/lib/template.js";
import { StatusSchema, type Lead } from "../../src/lib/schema.js";

/**
 * Tests deterministas de build-web: cubren la vista PURA (Lead ->
 * objeto de template), los helpers puros, el guard de status y el render REAL de
 * la plantilla `doctor/dr_arefin.html`. El I/O de disco (readLead/writeArtifact/
 * writeLead) no se testea aca a proposito.
 *
 * El fixture calca el lead dorado real `carlos-cred`: negocio SIN `name` (todo
 * cuelga de la persona), horario referencial por rubro, testimonios de ejemplo,
 * credenciales en attrs y copy generado completo.
 */
function enrichedLead(overrides: Partial<Lead> = {}): Lead {
  return {
    slug: "carlos-cred",
    status: "enriched",
    rubro: "doctor",
    source: {
      card_front: "card_front.jpg",
      card_back: "card_back.jpg",
      ingested_at: "2026-07-09T23:22:41.554Z",
      channel: "manual",
    },
    business: {
      name: "",
      person_name: "Dr. Carlos Adrian Cortes Victoria",
      tagline: "MEDICINA INTERNA ● ENDOCRINOLOGIA",
      attrs: {
        Universidad: "Universidad Autónoma Benito Juárez de Oaxaca, Universidad Nacional Autónoma de México",
        "Cédula profesional": "120 0 70 41",
        "Cédula de especialidad": "139370 97, 14886103",
        Certificación: "Consejo Mexicano de Medicina Interna, Consejo Mexicano de Endocrinología",
      },
    },
    contact: {
      phones: ["9513487626"],
      address: "Torre Medica Universidad, Avenida Universidad 100, Universidad, Exhacienda Candiani, 71233 Santa Cruz Xoxocotlán, Oax.",
      hours: "Lunes a Viernes 9:00-18:00, Sabado 9:00-14:00",
    },
    socials: {},
    brand: {
      palette: ["#bbbec2", "#382d47", "#b0aaa7", "#bec2c5", "#4b4362", "#5f5877", "#847892", "#b9bfbf"],
      colors: { primary: "#382d47", secondary: "#5f5877", accent: "#847892", text: "#382d47" },
      colorsText: { primary: "#ffffff", secondary: "#ffffff", accent: "#000000" },
      has_logo: true,
      font_hint: "sans",
    },
    content: {
      services: ["Consulta", "Estudios", "Seguimiento"],
      generated_copy: {
        hero_headline: "Atención especializada en medicina interna y endocrinología",
        hero_subheadline: "El Dr. Carlos Adrián Cortés Victoria ofrece un enfoque integral y profesional.",
        hero_badge: "Atención médica profesional",
        bio: "El Dr. Carlos Adrián Cortés Victoria es un profesional dedicado a la medicina interna y la endocrinología.",
        pull_quote: "Mi compromiso es brindar una atención médica humana.",
        value_props: [
          { title: "Enfoque integral", description: "Evaluamos su salud de manera completa." },
          { title: "Atención personalizada", description: "Cada paciente recibe un trato cercano." },
          { title: "Seguimiento constante", description: "Acompañamos su proceso médico con dedicación." },
        ],
        service_descriptions: [
          { name: "Consulta", description: "Evaluación médica profesional." },
          { name: "Estudios", description: "Realización de pruebas diagnósticas." },
          { name: "Seguimiento", description: "Monitoreo periódico de su evolución." },
        ],
        faqs: [
          { question: "¿Cómo puedo agendar una cita?", answer: "Puede ponerse en contacto directamente." },
          { question: "¿Qué debo llevar a mi primera visita?", answer: "Se recomienda traer estudios previos." },
        ],
        testimonials: [
          { quote: "La atención recibida fue muy profesional.", author: "Paciente" },
          { quote: "Agradezco la dedicación y el seguimiento constante.", author: "Cliente" },
          { quote: "Un trato humano y muy respetuoso.", author: "Juan P." },
        ],
        cta_headline: "Agende su próxima consulta médica",
        cta_subtext: "Estamos listos para atenderle.",
        footer_tagline: "Medicina interna y endocrinología al servicio de su salud.",
        meta_title: "Dr. Carlos Adrián Cortés Victoria | Medicina Interna y Endocrinología",
        meta_description: "Atención especializada en medicina interna y endocrinología.",
        generated_at: "2026-07-09T23:28:23.068Z",
        sample_fields: ["testimonials"],
      },
    },
    generated: {},
    meta: {
      needs: [
        "falta nombre del negocio",
        "horario sugerido por rubro (no estaba en la tarjeta), confirmar/ajustar",
        "testimonios de EJEMPLO generados, reemplazar por reales antes de publicar",
      ],
      errors: [],
      updated_at: "2026-07-09T23:28:23.069Z",
    },
    ...overrides,
  };
}

const TEMPLATE_URL = new URL("../../src/templates/doctor/dr_arefin.html", import.meta.url);
async function renderWeb(lead: Lead = enrichedLead()): Promise<string> {
  const template = await fs.readFile(fileURLToPath(TEMPLATE_URL), "utf8");
  return renderTemplate(template, buildWebView(lead, 2026));
}

describe("webAssetSrc — normaliza rutas de imagen para la subcarpeta web/", () => {
  it("ruta relativa del lead sube un nivel (web/ vive bajo la carpeta del lead)", () => {
    expect(webAssetSrc("logo.png")).toBe("../logo.png");
    expect(webAssetSrc("./logo.png")).toBe("../logo.png");
  });

  it("data URI y URLs absolutas pasan intactas", () => {
    expect(webAssetSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(webAssetSrc("https://cdn.x/logo.png")).toBe("https://cdn.x/logo.png");
  });

  it("sin ruta => cadena vacia", () => {
    expect(webAssetSrc(undefined)).toBe("");
    expect(webAssetSrc("")).toBe("");
  });
});

describe("hoursAreReferential — detecta el horario sugerido por rubro", () => {
  it("true si meta.needs trae la anotacion de horario", () => {
    expect(hoursAreReferential(enrichedLead())).toBe(true);
  });

  it("false si el humano confirmo el horario (sin la anotacion)", () => {
    const lead = enrichedLead();
    lead.meta.needs = lead.meta.needs.filter((n) => !n.startsWith("horario sugerido por rubro"));
    expect(hoursAreReferential(lead)).toBe(false);
  });
});

describe("buildWebView — identidad e imagen (cascada, cero caras falsas)", () => {
  it("nombre cae a la persona cuando el negocio no tiene name", () => {
    const view = buildWebView(enrichedLead());
    expect(view.heroName).toBe("Dr. Carlos Adrian Cortes Victoria");
    expect(view.initial).toBe("D");
  });

  it("cascada nombre: persona > negocio > slug", () => {
    const soloNegocio = enrichedLead();
    soloNegocio.business.person_name = undefined;
    soloNegocio.business.name = "Clínica X";
    expect(buildWebView(soloNegocio).heroName).toBe("Clínica X");

    const soloSlug = enrichedLead();
    soloSlug.business.person_name = undefined;
    soloSlug.business.name = "";
    expect(buildWebView(soloSlug).heroName).toBe("carlos-cred");
  });

  it("has_logo true pero sin ruta en disco => sin imagen (placeholder de iniciales)", () => {
    const view = buildWebView(enrichedLead());
    expect(view.hasImage).toBe(false);
    expect(view.imageSrc).toBe("");
  });

  it("logo_path presente => imagen con ruta ajustada; photo_path tiene prioridad", () => {
    const conLogo = enrichedLead();
    conLogo.brand.logo_path = "logo.png";
    const v1 = buildWebView(conLogo);
    expect(v1.hasImage).toBe(true);
    expect(v1.imageSrc).toBe("../logo.png");

    conLogo.brand.photo_path = "foto.jpg";
    expect(buildWebView(conLogo).imageSrc).toBe("../foto.jpg");
  });
});

describe("buildWebView — contacto derivado (reusa helpers de build-cards)", () => {
  it("WhatsApp derivado de phones[0] con codigo de pais", () => {
    const view = buildWebView(enrichedLead());
    expect(view.hasWhatsapp).toBe(true);
    expect(view.whatsappUrl).toMatch(/^https:\/\/wa\.me\/529513487626\?text=/);
  });

  it("telefono a tel: de solo digitos; direccion con maps", () => {
    const view = buildWebView(enrichedLead());
    expect(view.phoneTelHref).toBe("tel:9513487626");
    expect(view.hasAddress).toBe(true);
    expect(view.mapsUrl).toContain("google.com/maps/search/?api=1&query=");
  });

  it("sin telefono no hay WhatsApp ni CTA de llamada", () => {
    const view = buildWebView(enrichedLead({ contact: { address: "Calle 1" } }));
    expect(view.hasWhatsapp).toBe(false);
    expect(view.hasPhone).toBe(false);
  });

  it("horario: parte por coma en lineas y marca referencial segun meta.needs", () => {
    const view = buildWebView(enrichedLead());
    expect(view.hoursLines).toEqual(["Lunes a Viernes 9:00-18:00", "Sabado 9:00-14:00"]);
    expect(view.hasHours).toBe(true);
    expect(view.hoursReferential).toBe(true);
  });
});

describe("buildWebView — servicios, credenciales, copy", () => {
  it("servicios reales casan su descripcion generada por nombre", () => {
    const view = buildWebView(enrichedLead());
    const services = view.services as { name: string; description: string; hasDescription: boolean }[];
    expect(services.map((s) => s.name)).toEqual(["Consulta", "Estudios", "Seguimiento"]);
    expect(services[0]!.hasDescription).toBe(true);
    expect(services[0]!.description).toContain("Evaluación médica");
  });

  it("servicio sin descripcion generada queda sin texto (no inventa)", () => {
    const lead = enrichedLead();
    lead.content.services = ["Consulta", "Servicio nuevo"];
    const services = buildWebView(lead).services as { name: string; hasDescription: boolean }[];
    expect(services[1]!.name).toBe("Servicio nuevo");
    expect(services[1]!.hasDescription).toBe(false);
  });

  it("credenciales: business.attrs a lista {key,value}, tal cual (sin limpiar formato)", () => {
    const view = buildWebView(enrichedLead());
    expect(view.hasAttrs).toBe(true);
    const attrs = view.attrs as { key: string; value: string }[];
    expect(attrs[1]).toEqual({ key: "Cédula profesional", value: "120 0 70 41" });
  });

  it("testimonios marcados como ejemplo via sample_fields", () => {
    expect(buildWebView(enrichedLead()).testimonialsAreSample).toBe(true);

    const lead = enrichedLead();
    lead.content.generated_copy!.sample_fields = [];
    expect(buildWebView(lead).testimonialsAreSample).toBe(false);
  });
});

describe("buildWebView — tema (colores de marca + fallback)", () => {
  it("usa los colores medidos y su colorsText WCAG tal cual", () => {
    const view = buildWebView(enrichedLead());
    expect(view.colors).toEqual({ primary: "#382d47", secondary: "#5f5877", accent: "#847892" });
    expect(view.colorsText).toEqual({ primary: "#ffffff", secondary: "#ffffff", accent: "#000000" });
  });

  it("sin colores medidos cae al par de reserva completo", () => {
    const lead = enrichedLead();
    lead.brand = { colors: {}, has_logo: false };
    const view = buildWebView(lead);
    expect(view.colors).toEqual({ primary: "#111827", secondary: "#374151", accent: "#2563eb" });
    expect(view.colorsText).toEqual({ primary: "#ffffff", secondary: "#ffffff", accent: "#ffffff" });
  });

  it("meta: usa meta_title del copy y year es parametro (determinista)", () => {
    const view = buildWebView(enrichedLead(), 2030);
    expect(view.pageTitle).toContain("Medicina Interna");
    expect(view.year).toBe(2030);
  });
});

describe("assertWebBuildableStatus — guard", () => {
  it("rechaza estados previos a enriched con mensaje claro", () => {
    expect(() => assertWebBuildableStatus("verified")).toThrow(/enrich/);
    expect(() => assertWebBuildableStatus("ingested")).toThrow(/extract/);
  });

  it("rechaza error aunque en el enum quede despues de enriched", () => {
    expect(() => assertWebBuildableStatus("error")).toThrow(/error/);
  });

  it("acepta enriched y todos los estados posteriores del camino feliz", () => {
    const order = StatusSchema.options;
    const desde = order.slice(order.indexOf("enriched")).filter((s) => s !== "error");
    for (const status of desde) {
      expect(() => assertWebBuildableStatus(status)).not.toThrow();
    }
  });
});

describe("render de la plantilla doctor/dr_arefin.html (contrato vista <-> HTML)", () => {
  it("no deja marcadores {{ }} sin resolver ni 'undefined'", async () => {
    const html = await renderWeb();
    expect(html).not.toMatch(/\{\{/);
    expect(html).not.toContain("undefined");
  });

  it("muestra el copy real: headline, bio, CTA y WhatsApp derivado", async () => {
    const html = await renderWeb();
    expect(html).toContain("Atención especializada en medicina interna");
    expect(html).toContain("Agende su próxima consulta médica");
    expect(html).toContain("wa.me/529513487626");
  });

  it("tematiza con los colores de marca medidos (CSS vars)", async () => {
    const html = await renderWeb();
    expect(html).toContain("--brand-primary: #382d47");
    expect(html).toContain("--brand-primary-text: #ffffff");
    expect(html).toContain("--brand-accent: #847892");
  });

  it("cero caras falsas: sin foto de stock (Unsplash) y con placeholder de iniciales", async () => {
    const html = await renderWeb();
    expect(html).not.toContain("unsplash");
    expect(html).not.toContain("<img"); // este lead no tiene logo/foto => placeholder
    expect(html).toContain("linear-gradient(135deg, var(--brand-primary), var(--brand-accent))");
    expect(html).toContain(">D</span>"); // inicial de la persona
  });

  it("sin stats inventados (el mockup traia '12k+ pacientes')", async () => {
    const html = await renderWeb();
    expect(html).not.toContain("12k+");
    expect(html).not.toContain("Pacientes Satisfechos");
  });

  it("renderiza credenciales desde attrs, tal cual (cedulas con formato imperfecto)", async () => {
    const html = await renderWeb();
    expect(html).toContain("Cédula profesional");
    expect(html).toContain("120 0 70 41");
    expect(html).toContain("Universidad Autónoma Benito Juárez de Oaxaca");
  });

  it("aviso 'de ejemplo' LIGADO a la seccion de testimonios (badge + tag por card)", async () => {
    const html = await renderWeb();
    expect(html).toContain("Testimonios de ejemplo");
    expect(html).toContain(">Ejemplo<"); // tag por card
    expect(html).toContain("La atención recibida fue muy profesional");
  });

  it("horario referencial marcado cuando viene del default por rubro", async () => {
    const html = await renderWeb();
    expect(html).toContain(">Referencial<");
    expect(html).toContain("Horario sugerido, sujeto a confirmación");
  });

  it("horario SIN marca cuando el humano lo confirmo", async () => {
    const lead = enrichedLead();
    lead.meta.needs = lead.meta.needs.filter((n) => !n.startsWith("horario sugerido por rubro"));
    const template = await fs.readFile(fileURLToPath(TEMPLATE_URL), "utf8");
    const html = renderTemplate(template, buildWebView(lead, 2026));
    expect(html).toContain("Lunes a Viernes 9:00-18:00"); // el horario sigue
    expect(html).not.toContain(">Referencial<");
  });

  it("disclaimer de demostracion al pie", async () => {
    const html = await renderWeb();
    expect(html).toContain("Sitio de demostración — contiene datos de ejemplo");
  });

  it("con logo real en disco usa <img> en vez del placeholder", async () => {
    const lead = enrichedLead();
    lead.brand.logo_path = "logo.png";
    const template = await fs.readFile(fileURLToPath(TEMPLATE_URL), "utf8");
    const html = renderTemplate(template, buildWebView(lead, 2026));
    expect(html).toContain('src="../logo.png"');
  });

  it("sin testimonios de ejemplo: no aparece el aviso ligado a la seccion", async () => {
    const lead = enrichedLead();
    lead.content.generated_copy!.sample_fields = [];
    const template = await fs.readFile(fileURLToPath(TEMPLATE_URL), "utf8");
    const html = renderTemplate(template, buildWebView(lead, 2026));
    expect(html).not.toContain("Testimonios de ejemplo");
    expect(html).not.toContain(">Ejemplo<");
    expect(html).toContain("La atención recibida fue muy profesional"); // los testimonios igual se muestran
  });
});

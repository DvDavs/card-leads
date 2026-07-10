import { promises as fs, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertWebBuildableStatus,
  buildWebView,
  fnv1a,
  hoursAreReferential,
  orderWebPoolByRubro,
  resolveWebImages,
  webAssetSrc,
  type WebImageManifest,
} from "../../src/stages/build-web.js";
import { injectBrandToggle } from "../../src/stages/build-cards.js";
import { renderTemplate } from "../../src/lib/template.js";
import { StatusSchema, type Lead } from "../../src/lib/schema.js";

/**
 * Tests deterministas de build-web: helpers puros, guard de status, la
 * resolucion PURA de imagenes del banco (`resolveWebImages`), la vista PURA
 * en espanol (`buildWebView`, registro UNION del brief) y el render REAL de
 * TODO el pool por glob de `src/templates/doctor/` (invariantes + secciones
 * caracteristicas por plantilla). El I/O de disco (readLead/writeArtifact/
 * copyFilesIntoLead) no se testea aca a proposito.
 *
 * El pool y el manifest se descubren del filesystem REAL: si se agrega una
 * plantilla nueva a la carpeta, los invariantes le aplican solos (brief §9).
 */

const TEMPLATES_DIR = fileURLToPath(new URL("../../src/templates/doctor/", import.meta.url));
const BANK_DIR = path.join(TEMPLATES_DIR, "assets");
const MANIFEST = JSON.parse(
  readFileSync(path.join(BANK_DIR, "manifest.json"), "utf8"),
) as WebImageManifest;

/** El pool real por glob: todo *.html sin prefijo "_" (el filesystem es el manifest). */
const POOL_FILES = readdirSync(TEMPLATES_DIR)
  .filter((f) => f.endsWith(".html") && !f.startsWith("_"))
  .sort();

/**
 * Fixture dorado: calca el lead real `carlos-cred` (negocio SIN `name`,
 * horario referencial, credenciales en attrs) + el copy completo de enrich
 * con el bloque `demo` lleno (stats, equipo, CV, mision, sedacion, etc.) y
 * `person_gender` para la eleccion de retratos.
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
      person_gender: "m",
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
          { question: "¿Atiende urgencias?", answer: "Consulte disponibilidad por teléfono." },
        ],
        testimonials: [
          { quote: "La atención recibida fue muy profesional.", author: "Paciente" },
          { quote: "Agradezco la dedicación y el seguimiento constante.", author: "Cliente" },
          { quote: "Un trato humano y muy respetuoso.", author: "Juan P." },
          { quote: "Excelente seguimiento a mi tratamiento de tiroides.", author: "María G.", role: "Paciente de endocrinología" },
        ],
        cta_headline: "Agende su próxima consulta médica",
        cta_subtext: "Estamos listos para atenderle.",
        footer_tagline: "Medicina interna y endocrinología al servicio de su salud.",
        meta_title: "Dr. Carlos Adrián Cortés Victoria | Medicina Interna y Endocrinología",
        meta_description: "Atención especializada en medicina interna y endocrinología.",
        generated_at: "2026-07-09T23:28:23.068Z",
        sample_fields: ["testimonials", "demo"],
        demo: {
          stats: [
            { value: "+15", label: "Años de experiencia" },
            { value: "5,000", label: "Consultas realizadas" },
            { value: "98%", label: "Pacientes que regresan" },
            { value: "24h", label: "Respuesta a mensajes" },
          ],
          team: [
            { name: "Dra. Ana Morales", role: "Endocrinología", gender: "f" },
            { name: "Dr. Luis Herrera", role: "Medicina interna", gender: "m" },
            { name: "Dra. Carmen Ruiz", role: "Nutrición clínica", gender: "f" },
            { name: "Dr. Jorge Peña", role: "Cardiología", gender: "m" },
            { name: "Dra. Sofía Vargas", role: "Medicina general", gender: "f" },
          ],
          experience: [
            { role: "Jefe de Endocrinología", place: "Hospital General de Oaxaca", period: "2018 — Presente", description: "Coordinación del servicio y atención de casos complejos.", current: true },
            { role: "Médico adscrito", place: "Clínica del Centro", period: "2012 — 2018", description: "Consulta de medicina interna y seguimiento de pacientes crónicos.", current: false },
          ],
          education: [
            { degree: "Especialidad en Endocrinología", institution: "Universidad Nacional Autónoma de México", period: "2008 — 2012", details: ["Mención honorífica", "Residencia en hospital de tercer nivel"] },
            { degree: "Médico Cirujano", institution: "Universidad Autónoma Benito Juárez de Oaxaca", period: "2000 — 2006", details: [] },
          ],
          research: [
            { tag: "Publicación", title: "Control glucémico en adultos mayores", description: "Estudio observacional multicéntrico sobre metas de control." },
            { tag: "Congreso", title: "Manejo integral del hipotiroidismo", description: "Ponencia magistral en congreso nacional." },
          ],
          skills: ["Diabetes tipo 2", "Trastornos de tiroides", "Obesidad y síndrome metabólico"],
          languages: [
            { language: "Español", level: "Nativo" },
            { language: "Inglés", level: "Profesional" },
          ],
          mission: "Cuidar la salud de cada familia con medicina basada en evidencia y trato humano.",
          patient_education: [
            { title: "Prevención de diabetes", description: "Hábitos de alimentación y ejercicio para reducir el riesgo." },
            { title: "Cuidado de la tiroides", description: "Señales tempranas que ameritan una revisión médica." },
          ],
          sedation: {
            title: "Sedación consciente",
            description: "Opciones seguras para pacientes con ansiedad al procedimiento.",
            points: ["Monitoreo continuo de signos vitales", "Recuperación rápida el mismo día"],
          },
          hygiene: [
            { title: "Esterilización certificada", description: "Instrumental esterilizado en autoclave tras cada consulta." },
            { title: "Sanitización de espacios", description: "Consultorio sanitizado entre paciente y paciente." },
          ],
          urgency: { headline: "¿Necesita atención inmediata?", subtext: "Respondemos llamadas de urgencia las 24 horas." },
          availability_badge: "Disponible hoy",
          rating: { value: "4.9", count_label: "120 reseñas" },
          trust_items: ["Especialistas certificados", "Protocolos de bioseguridad", "Atención puntual"],
        },
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

/**
 * Lead "vacio-ish": sin demo, sin foto, sin copy generado, sin contacto mas
 * alla del telefono. Las secciones unicas deben COLAPSAR (guards en false) y
 * el render no debe dejar tokens ni "undefined".
 */
function emptyishLead(): Lead {
  const lead = enrichedLead();
  lead.business.attrs = {};
  lead.business.tagline = undefined;
  lead.contact = { phones: ["9513487626"] };
  lead.content = { services: [] };
  lead.meta.needs = [];
  return lead;
}

function resolvedImages(lead: Lead) {
  return resolveWebImages(lead, MANIFEST, BANK_DIR);
}

/** Render FINAL como lo produce buildWeb: view + toggle de marca inyectado. */
async function renderFinal(file: string, lead: Lead = enrichedLead()): Promise<string> {
  const template = await fs.readFile(path.join(TEMPLATES_DIR, file), "utf8");
  return injectBrandToggle(renderTemplate(template, buildWebView(lead, 2026, resolvedImages(lead))));
}

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

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

describe("orderWebPoolByRubro — plantilla preferida del rubro primero", () => {
  const pool = POOL_FILES.map((file) => ({ key: file.replace(/\.html$/, ""), file }));

  it("doctor abre con doc-clasico; el resto conserva el orden alfabetico", () => {
    const ordered = orderWebPoolByRubro(pool, "doctor");
    expect(ordered[0]!.key).toBe("doc-clasico");
    expect(ordered).toHaveLength(pool.length);
    expect(new Set(ordered.map((p) => p.file))).toEqual(new Set(pool.map((p) => p.file)));
  });

  it("si la preferida no esta en el pool, no toca el orden", () => {
    const sinClasico = pool.filter((p) => p.key !== "doc-clasico");
    expect(orderWebPoolByRubro(sinClasico, "doctor")).toEqual(sinClasico);
  });
});

/* ------------------------------------------------------------------ */
/* resolveWebImages — banco de imagenes determinista                   */
/* ------------------------------------------------------------------ */

describe("resolveWebImages — eleccion sembrada del banco por slot", () => {
  it("fnv1a es estable (misma cadena -> mismo hash)", () => {
    expect(fnv1a("carlos-cred:img_hero_01")).toBe(fnv1a("carlos-cred:img_hero_01"));
    expect(fnv1a("a")).not.toBe(fnv1a("b"));
  });

  it("determinista: mismo lead -> exactamente las mismas elecciones", () => {
    const a = resolvedImages(enrichedLead());
    const b = resolvedImages(enrichedLead());
    expect(a).toEqual(b);
  });

  it("retrato principal respeta el genero del lead (m -> RetratoDoctor, f -> RetratoDoctora)", () => {
    const hombre = resolvedImages(enrichedLead());
    expect(hombre.slots.img_retrato_principal).toMatch(/^assets\/RetratoDoctor0\d\.jpg$/);

    const lead = enrichedLead();
    lead.business.person_gender = "f";
    const mujer = resolvedImages(lead);
    expect(mujer.slots.img_retrato_principal).toMatch(/^assets\/RetratoDoctora0\d\.jpg$/);
  });

  it("sin genero conocido cae a retratos mixtos (kind-only), sin romper", () => {
    const lead = enrichedLead();
    lead.business.person_gender = undefined;
    const { slots } = resolvedImages(lead);
    expect(slots.img_retrato_principal).toMatch(/^assets\/Retrato/);
  });

  it("foto real del lead (photo_path) manda: slot = ../foto y NO consume banco para el retrato", () => {
    const lead = enrichedLead();
    lead.brand.photo_path = "foto.jpg";
    const { slots, files } = resolvedImages(lead);
    expect(slots.img_retrato_principal).toBe("../foto.jpg");
    // files == exactamente los archivos del banco que aparecen en slots
    const consumidos = new Set(
      Object.values(slots)
        .filter((v) => v.startsWith("assets/"))
        .map((v) => v.slice("assets/".length)),
    );
    expect(new Set(files.map((f) => f.to.replace("web/assets/", "")))).toEqual(consumidos);
  });

  it("hero 01 y 02 son instalaciones distintas; consultorio 01 != 02", () => {
    const { slots } = resolvedImages(enrichedLead());
    expect(slots.img_hero_01).toMatch(/^assets\/(Consultorio|Recepcion)/);
    expect(slots.img_hero_02).toMatch(/^assets\/(Consultorio|Recepcion)/);
    expect(slots.img_hero_01).not.toBe(slots.img_hero_02);
    expect(slots.img_consultorio_01).not.toBe(slots.img_consultorio_02);
  });

  it("avatares: retratos distintos entre si y ninguno es el principal", () => {
    const { slots } = resolvedImages(enrichedLead());
    const avatares = [slots.img_avatar_01, slots.img_avatar_02, slots.img_avatar_03];
    expect(new Set(avatares).size).toBe(3);
    for (const a of avatares) {
      expect(a).toMatch(/^assets\/Retrato/);
      expect(a).not.toBe(slots.img_retrato_principal);
    }
  });

  it("todos los kinds simples resuelven a su categoria", () => {
    const { slots } = resolvedImages(enrichedLead());
    expect(slots.img_equipo_01).toMatch(/^assets\/Equipo/);
    expect(slots.img_sonrisa_01).toMatch(/^assets\/Sonrisa/);
    expect(slots.img_recepcion_01).toMatch(/^assets\/Recepcion/);
  });

  it("files: solo lo consumido, deduplicado, con destino web/assets/ y origen en el banco", () => {
    const { slots, files } = resolvedImages(enrichedLead());
    expect(new Set(files.map((f) => f.to)).size).toBe(files.length); // dedupe
    for (const f of files) {
      expect(f.to).toMatch(/^web\/assets\//);
      expect(f.from.startsWith(BANK_DIR)).toBe(true);
    }
    const consumidos = new Set(
      Object.values(slots)
        .filter((v) => v.startsWith("assets/"))
        .map((v) => v.slice("assets/".length)),
    );
    expect(new Set(files.map((f) => f.to.replace("web/assets/", "")))).toEqual(consumidos);
  });

  it("banco vacio: slots en cadena vacia y cero archivos (no rompe)", () => {
    const { slots, files } = resolveWebImages(enrichedLead(), { images: [] }, BANK_DIR);
    expect(slots.img_retrato_principal).toBe("");
    expect(slots.img_hero_01).toBe("");
    expect(files).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* buildWebView — registro UNION en espanol                            */
/* ------------------------------------------------------------------ */

describe("buildWebView — identidad y meta", () => {
  it("nombre cae a la persona cuando el negocio no tiene name; inicial en mayuscula", () => {
    const view = buildWebView(enrichedLead());
    expect(view.nombre).toBe("Dr. Carlos Adrian Cortes Victoria");
    expect(view.inicial).toBe("D");
  });

  it("cascada nombre: persona > negocio > slug", () => {
    const soloNegocio = enrichedLead();
    soloNegocio.business.person_name = undefined;
    soloNegocio.business.name = "Clínica X";
    expect(buildWebView(soloNegocio).nombre).toBe("Clínica X");

    const soloSlug = enrichedLead();
    soloSlug.business.person_name = undefined;
    soloSlug.business.name = "";
    expect(buildWebView(soloSlug).nombre).toBe("carlos-cred");
  });

  it("meta_titulo usa el meta_title del copy; anio es parametro (determinista)", () => {
    const view = buildWebView(enrichedLead(), 2030);
    expect(view.meta_titulo).toContain("Medicina Interna");
    expect(view.anio).toBe(2030);
  });

  it("sin copy generado, meta y hero caen a tagline/nombre y footer_bio nunca queda vacio", () => {
    const lead = emptyishLead();
    const view = buildWebView(lead);
    expect(view.hero_titulo).toBe("Dr. Carlos Adrian Cortes Victoria");
    expect(view.meta_titulo).toBe("Dr. Carlos Adrian Cortes Victoria");
    expect(view.footer_bio).toBe("Dr. Carlos Adrian Cortes Victoria");
    expect(view.cta_titulo).toBe("Contactanos");
    expect(view.hero_cta).toBe("Agendar cita");
  });
});

describe("buildWebView — contacto derivado (datos reales, nunca del LLM)", () => {
  it("telefono_href trae SOLO digitos y +; el template pone el tel:", () => {
    const view = buildWebView(enrichedLead());
    expect(view.telefono_href).toBe("9513487626");
    expect(view.telefono).toBe("9513487626");
    expect(view.tiene_telefono).toBe(true);
  });

  it("WhatsApp derivado de phones[0] con codigo de pais", () => {
    const view = buildWebView(enrichedLead());
    expect(view.tiene_whatsapp).toBe(true);
    expect(view.whatsapp_url).toMatch(/^https:\/\/wa\.me\/529513487626\?text=/);
  });

  it("direccion en una linea + mapa_url + mapa_embed_url (URL segura, output=embed)", () => {
    const view = buildWebView(enrichedLead());
    expect(view.tiene_direccion).toBe(true);
    expect(view.mapa_url).toContain("google.com/maps/search/?api=1&query=");
    expect(view.mapa_embed_url).toMatch(/^https:\/\/www\.google\.com\/maps\?q=.+&output=embed$/);
    expect(view.mapa_embed_url).not.toContain(" "); // encodeURIComponent aplicado
    expect(view.mapa_embed_url).not.toContain('"');
  });

  it("sin telefono no hay WhatsApp; sin direccion no hay mapa embebido", () => {
    const view = buildWebView(enrichedLead({ contact: {} }));
    expect(view.tiene_telefono).toBe(false);
    expect(view.tiene_whatsapp).toBe(false);
    expect(view.tiene_direccion).toBe(false);
    expect(view.mapa_embed_url).toBe("");
  });

  it("horario: parte por coma en lineas y marca referencial segun meta.needs", () => {
    const view = buildWebView(enrichedLead());
    expect(view.horario_lineas).toEqual(["Lunes a Viernes 9:00-18:00", "Sabado 9:00-14:00"]);
    expect(view.tiene_horario).toBe(true);
    expect(view.horario_referencial).toBe(true);
  });
});

describe("buildWebView — servicios, credenciales, propuestas, copy", () => {
  it("servicios reales casan su descripcion generada por nombre (claves en espanol)", () => {
    const view = buildWebView(enrichedLead());
    const servicios = view.servicios as { n: string; nombre: string; descripcion: string; tiene_descripcion: boolean }[];
    expect(servicios.map((s) => s.nombre)).toEqual(["Consulta", "Estudios", "Seguimiento"]);
    expect(servicios[0]!.n).toBe("01");
    expect(servicios[0]!.tiene_descripcion).toBe(true);
    expect(servicios[0]!.descripcion).toContain("Evaluación médica");
  });

  it("servicio sin descripcion generada queda sin texto (no inventa)", () => {
    const lead = enrichedLead();
    lead.content.services = ["Consulta", "Servicio nuevo"];
    const servicios = buildWebView(lead).servicios as { nombre: string; tiene_descripcion: boolean }[];
    expect(servicios[1]!.nombre).toBe("Servicio nuevo");
    expect(servicios[1]!.tiene_descripcion).toBe(false);
  });

  it("credenciales: business.attrs a lista {clave,valor}, tal cual (sin limpiar formato)", () => {
    const view = buildWebView(enrichedLead());
    expect(view.tiene_credenciales).toBe(true);
    const credenciales = view.credenciales as { clave: string; valor: string }[];
    expect(credenciales[1]).toEqual({ clave: "Cédula profesional", valor: "120 0 70 41" });
  });

  it("propuestas mapean value_props a {titulo, descripcion}", () => {
    const propuestas = buildWebView(enrichedLead()).propuestas as { titulo: string; descripcion: string }[];
    expect(propuestas[0]).toEqual({ titulo: "Enfoque integral", descripcion: "Evaluamos su salud de manera completa." });
  });

  it("testimonios: {cita, autor, rol, tiene_rol} + marca de ejemplo via sample_fields", () => {
    const view = buildWebView(enrichedLead());
    const testimonios = view.testimonios as { cita: string; autor: string; rol: string; tiene_rol: boolean }[];
    expect(testimonios).toHaveLength(4);
    expect(testimonios[0]!.tiene_rol).toBe(false);
    expect(testimonios[3]).toEqual({
      cita: "Excelente seguimiento a mi tratamiento de tiroides.",
      autor: "María G.",
      rol: "Paciente de endocrinología",
      tiene_rol: true,
    });
    expect(view.testimonios_son_ejemplo).toBe(true);
  });

  it("faq mapea {pregunta, respuesta} y corta a maximo 9", () => {
    const lead = enrichedLead();
    lead.content.generated_copy!.faqs = Array.from({ length: 12 }, (_, i) => ({
      question: `Pregunta ${i + 1}`,
      answer: `Respuesta ${i + 1}`,
    }));
    const faq = buildWebView(lead).faq as { pregunta: string; respuesta: string }[];
    expect(faq).toHaveLength(9);
    expect(faq[0]).toEqual({ pregunta: "Pregunta 1", respuesta: "Respuesta 1" });
  });
});

describe("buildWebView — contenido demo (claves espanol, guards tiene_*)", () => {
  it("stats mapean {valor, etiqueta} y cortan a maximo 4", () => {
    const lead = enrichedLead();
    lead.content.generated_copy!.demo!.stats = Array.from({ length: 6 }, (_, i) => ({
      value: `${i}`,
      label: `Stat ${i}`,
    }));
    const stats = buildWebView(lead).stats as { valor: string; etiqueta: string }[];
    expect(stats).toHaveLength(4);
    expect(stats[0]).toEqual({ valor: "0", etiqueta: "Stat 0" });
  });

  it("nuestro_equipo: 5 miembros con retrato por genero y SOLO el del medio destacado", () => {
    const lead = enrichedLead();
    const view = buildWebView(lead, 2026, resolvedImages(lead));
    const equipo = view.nuestro_equipo as { nombre: string; rol: string; img: string; destacado: boolean }[];
    expect(equipo).toHaveLength(5);
    expect(equipo.map((m) => m.destacado)).toEqual([false, false, true, false, false]);
    const principal = (view as Record<string, unknown>).img_retrato_principal as string;
    for (const m of equipo) {
      expect(m.img).toMatch(/^assets\/Retrato/);
      expect(m.img).not.toBe(principal);
    }
    // genero por miembro: f -> Doctora, m -> Doctor (sin la 'a')
    expect(equipo[0]!.img).toMatch(/RetratoDoctora/);
    expect(equipo[1]!.img).toMatch(/RetratoDoctor0/);
    // sin repetirse entre miembros mientras haya candidatos
    expect(new Set(equipo.map((m) => m.img)).size).toBe(5);
  });

  it("experiencia/educacion/investigacion/idiomas mapean claves del CV en espanol", () => {
    const view = buildWebView(enrichedLead());
    const experiencia = view.experiencia as Record<string, unknown>[];
    expect(experiencia[0]).toEqual({
      puesto: "Jefe de Endocrinología",
      lugar: "Hospital General de Oaxaca",
      periodo: "2018 — Presente",
      descripcion: "Coordinación del servicio y atención de casos complejos.",
      actual: true,
    });
    const educacion = view.educacion as Record<string, unknown>[];
    expect(educacion[0]!.titulo).toBe("Especialidad en Endocrinología");
    expect(educacion[0]!.detalles).toEqual(["Mención honorífica", "Residencia en hospital de tercer nivel"]);
    const investigacion = view.investigacion as Record<string, unknown>[];
    expect(investigacion[0]!.etiqueta).toBe("Publicación");
    const idiomas = view.idiomas as Record<string, unknown>[];
    expect(idiomas[0]).toEqual({ idioma: "Español", nivel: "Nativo" });
  });

  it("sedacion (objeto), cta_urgencia, calificacion {valor, resenas} y demas bloques", () => {
    const view = buildWebView(enrichedLead());
    expect(view.sedacion).toEqual({
      titulo: "Sedación consciente",
      descripcion: "Opciones seguras para pacientes con ansiedad al procedimiento.",
      puntos: ["Monitoreo continuo de signos vitales", "Recuperación rápida el mismo día"],
    });
    expect(view.cta_urgencia).toEqual({
      titulo: "¿Necesita atención inmediata?",
      subtexto: "Respondemos llamadas de urgencia las 24 horas.",
    });
    expect(view.calificacion).toEqual({ valor: "4.9", resenas: "120 reseñas" });
    expect(view.badge_disponibilidad).toBe("Disponible hoy");
    expect(view.tiene_confianza_items).toBe(true);
    expect(view.tiene_mision).toBe(true);
    expect(view.tiene_higiene_puntos).toBe(true);
    expect(view.tiene_educacion_paciente).toBe(true);
    expect(view.tiene_habilidades).toBe(true);
  });

  it("sin demo: TODOS los guards tiene_* de demo en false y demo_es_ejemplo sigue el sample_fields", () => {
    const lead = enrichedLead();
    lead.content.generated_copy!.demo = undefined;
    lead.content.generated_copy!.sample_fields = ["testimonials"];
    const view = buildWebView(lead);
    for (const guard of [
      "tiene_stats", "tiene_nuestro_equipo", "tiene_experiencia", "tiene_educacion",
      "tiene_investigacion", "tiene_habilidades", "tiene_idiomas", "tiene_mision",
      "tiene_educacion_paciente", "tiene_sedacion", "tiene_higiene_puntos",
      "tiene_cta_urgencia", "tiene_badge_disponibilidad", "tiene_calificacion",
      "tiene_confianza_items",
    ]) {
      expect(view[guard], guard).toBe(false);
    }
    expect(view.demo_es_ejemplo).toBe(true); // sample_fields no vacio

    lead.content.generated_copy!.sample_fields = [];
    expect(buildWebView(lead).demo_es_ejemplo).toBe(false);
  });

  it("doctor_cita y responsable_tecnico derivan del LEAD real, no del demo", () => {
    const view = buildWebView(enrichedLead());
    expect(view.doctor_cita).toEqual({
      nombre: "Dr. Carlos Adrian Cortes Victoria",
      rol: "MEDICINA INTERNA ● ENDOCRINOLOGIA",
    });
    expect(view.responsable_tecnico).toBe(
      "Dr. Carlos Adrian Cortes Victoria — Cédula profesional 120 0 70 41",
    );
    expect(view.tiene_responsable_tecnico).toBe(true);

    // sin tagline el rol cae al rol por rubro; sin persona no hay firma
    const sinTagline = enrichedLead();
    sinTagline.business.tagline = undefined;
    expect((buildWebView(sinTagline).doctor_cita as { rol: string }).rol).toBe("Médico titular");

    const sinPersona = enrichedLead();
    sinPersona.business.person_name = undefined;
    sinPersona.business.name = "Clínica X";
    const v = buildWebView(sinPersona);
    expect(v.tiene_doctor_cita).toBe(false);
    expect(v.tiene_responsable_tecnico).toBe(false);
  });
});

describe("buildWebView — tema (colores de marca + fallback, patron dc)", () => {
  it("usa los colores medidos y su colorsText WCAG tal cual", () => {
    const view = buildWebView(enrichedLead());
    expect(view.colors).toEqual({ primary: "#382d47", secondary: "#5f5877", accent: "#847892" });
    expect(view.colorsText).toEqual({ primary: "#ffffff", secondary: "#ffffff", accent: "#000000" });
    expect(view.hasBackground).toBe(false);
    expect(view.hasSurface).toBe(false);
  });

  it("background/surface medidos entran a colors con su flag has*", () => {
    const lead = enrichedLead();
    lead.brand.colors.background = "#f4f1ec";
    lead.brand.colors.surface = "#ffffff";
    const view = buildWebView(lead);
    expect(view.hasBackground).toBe(true);
    expect(view.hasSurface).toBe(true);
    expect((view.colors as Record<string, string>).background).toBe("#f4f1ec");
    expect((view.colors as Record<string, string>).surface).toBe("#ffffff");
  });

  it("sin colores medidos cae al par de reserva completo", () => {
    const lead = enrichedLead();
    lead.brand = { colors: {}, has_logo: false };
    const view = buildWebView(lead);
    expect(view.colors).toEqual({ primary: "#111827", secondary: "#374151", accent: "#2563eb" });
    expect(view.colorsText).toEqual({ primary: "#ffffff", secondary: "#ffffff", accent: "#ffffff" });
  });

  it("slots de imagen siempre presentes en el view (peor caso cadena vacia)", () => {
    const view = buildWebView(enrichedLead()); // sin imagenes resueltas
    expect(view.img_retrato_principal).toBe("");
    expect(view.img_hero_01).toBe("");
    expect(view.img_avatar_03).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* Invariantes sobre TODO el pool por glob (brief §10)                 */
/* ------------------------------------------------------------------ */

describe("pool por glob: hay plantillas y todas tienen etiqueta", () => {
  it("el glob encuentra el pool doctor (>= 6 plantillas doc-*)", () => {
    expect(POOL_FILES.length).toBeGreaterThanOrEqual(6);
    for (const f of POOL_FILES) expect(f).toMatch(/^doc-[a-z0-9-]+\.html$/);
  });
});

describe.each(POOL_FILES)("invariantes de %s (render final, fixture completo)", (file) => {
  it("no deja marcadores {{ }} sin resolver ni 'undefined'", async () => {
    const html = await renderFinal(file);
    expect(html).not.toMatch(/\{\{/);
    expect(html).not.toContain("undefined");
  });

  it("cero rastros prohibidos (CDNs de imagen, tracking, editores, placeholders viejos)", async () => {
    const html = await renderFinal(file);
    expect(html).not.toMatch(
      /unsplash|supabase|thryv|lirp|gtag|G-2M6V79H761|promotekit|aura\.build|transparenttextures|\[Nombre\]/i,
    );
  });

  it("doble paleta: :root[data-brand] con el hex primario medido del lead", async () => {
    const html = await renderFinal(file);
    expect(html).toContain(":root[data-brand]");
    expect(html).toContain("#382d47");
  });

  it("toggle de marca inyectado (protocolo dc-brand / dc-brand-ready)", async () => {
    const html = await renderFinal(file);
    expect(html).toContain("dc-brand-ready");
    expect(html).toContain("'dc-brand'");
    expect(html).toContain("data-brand");
  });

  it("aviso demo global presente (contenido de muestra)", async () => {
    const html = await renderFinal(file);
    expect(html).toMatch(/demostraci/i);
  });

  it("lead vacio-ish (sin demo, sin foto, sin copy): render limpio, sin tokens residuales", async () => {
    const html = await renderFinal(file, emptyishLead());
    expect(html).not.toMatch(/\{\{/);
    expect(html).not.toContain("undefined");
    // las secciones demo colapsan: nada del contenido de muestra sobrevive
    expect(html).not.toContain("Sedación consciente");
    expect(html).not.toContain("Dra. Ana Morales");
    expect(html).not.toContain("Cuidar la salud de cada familia");
  });
});

/* ------------------------------------------------------------------ */
/* Secciones caracteristicas por plantilla (matriz §3d del brief)      */
/* ------------------------------------------------------------------ */

describe("doc-clasico — stats flotantes + items de confianza", () => {
  it("renderiza el primer stat (valor + etiqueta) y los confianza_items", async () => {
    const html = await renderFinal("doc-clasico.html");
    expect(html).toContain("+15");
    expect(html).toContain("Años de experiencia");
    expect(html).toContain("Especialistas certificados");
    expect(html).toContain("Protocolos de bioseguridad");
  });

  it("usa el retrato principal del banco (assets/)", async () => {
    const lead = enrichedLead();
    const principal = resolvedImages(lead).slots.img_retrato_principal!;
    const html = await renderFinal("doc-clasico.html", lead);
    expect(html).toContain(`src="${principal}"`);
  });
});

describe("doc-perfil — CV: experiencia, educacion, idiomas, habilidades", () => {
  it("renderiza puestos, titulos, idiomas y chips de habilidades", async () => {
    const html = await renderFinal("doc-perfil.html");
    expect(html).toContain("Jefe de Endocrinología");
    expect(html).toContain("Médico adscrito");
    expect(html).toContain("Especialidad en Endocrinología");
    expect(html).toContain("Médico Cirujano");
    expect(html).toContain("Español");
    expect(html).toContain("Nativo");
    expect(html).toContain("Diabetes tipo 2");
    expect(html).toContain("Control glucémico en adultos mayores"); // investigacion
  });
});

describe("doc-lujo — higiene, firma del doctor, testimonios; sin <img>", () => {
  it("renderiza higiene_puntos, doctor_cita y los 4 testimonios", async () => {
    const html = await renderFinal("doc-lujo.html");
    expect(html).toContain("Esterilización certificada");
    expect(html).toContain("Sanitización de espacios");
    expect(html).toContain("Dr. Carlos Adrian Cortes Victoria");
    expect(html).toContain("MEDICINA INTERNA ● ENDOCRINOLOGIA"); // doctor_cita.rol = tagline
    expect(html).toContain("La atención recibida fue muy profesional.");
    expect(html).toContain("Agradezco la dedicación y el seguimiento constante.");
    expect(html).toContain("Un trato humano y muy respetuoso.");
    expect(html).toContain("Excelente seguimiento a mi tratamiento de tiroides.");
  });

  it("identidad sin fotos: cero tags <img>", async () => {
    const html = await renderFinal("doc-lujo.html");
    expect(html).not.toContain("<img");
  });
});

describe("doc-moderno — sedacion + imagenes de instalaciones", () => {
  it("renderiza el bloque de sedacion (titulo + puntos)", async () => {
    const html = await renderFinal("doc-moderno.html");
    expect(html).toContain("Sedación consciente");
    expect(html).toContain("Monitoreo continuo de signos vitales");
    expect(html).toContain("Recuperación rápida el mismo día");
  });

  it("img_consultorio_01 resuelve a un asset local del banco", async () => {
    const lead = enrichedLead();
    const consultorio = resolvedImages(lead).slots.img_consultorio_01!;
    expect(consultorio).toMatch(/^assets\/Consultorio/);
    const html = await renderFinal("doc-moderno.html", lead);
    expect(html).toContain(consultorio);
  });
});

describe("doc-limpio — 4 stats, equipo de 5 con destacado unico, faq", () => {
  it("renderiza los 4 stats", async () => {
    const html = await renderFinal("doc-limpio.html");
    for (const valor of ["+15", "5,000", "98%", "24h"]) expect(html).toContain(valor);
  });

  it("equipo: 5 nombres con retratos del banco y EXACTAMENTE un destacado", async () => {
    const html = await renderFinal("doc-limpio.html");
    for (const nombre of ["Dra. Ana Morales", "Dr. Luis Herrera", "Dra. Carmen Ruiz", "Dr. Jorge Peña", "Dra. Sofía Vargas"]) {
      expect(html).toContain(nombre);
    }
    expect(html).toContain("assets/Retrato");
    // la card central destacada usa el layout elevado (lg:-mt-12) UNA sola vez
    expect(html.match(/lg:-mt-12/g)).toHaveLength(1);
  });

  it("faq renderizada", async () => {
    const html = await renderFinal("doc-limpio.html");
    expect(html).toContain("¿Cómo puedo agendar una cita?");
    expect(html).toContain("Puede ponerse en contacto directamente.");
  });
});

describe("doc-familiar — mision, educacion al paciente, faq", () => {
  it("renderiza la mision y la educacion al paciente", async () => {
    const html = await renderFinal("doc-familiar.html");
    expect(html).toContain("Cuidar la salud de cada familia con medicina basada en evidencia y trato humano.");
    expect(html).toContain("Prevención de diabetes");
    expect(html).toContain("Cuidado de la tiroides");
  });

  it("faq renderizada y telefono como tel: con solo digitos", async () => {
    const html = await renderFinal("doc-familiar.html");
    expect(html).toContain("¿Qué debo llevar a mi primera visita?");
    expect(html).toContain('href="tel:9513487626"');
  });
});

describe("doc-urgencias — banda de urgencia, responsable tecnico, mapa embebido", () => {
  it("renderiza cta_urgencia, badge, stats y calificacion", async () => {
    const html = await renderFinal("doc-urgencias.html");
    expect(html).toContain("¿Necesita atención inmediata?");
    expect(html).toContain("Respondemos llamadas de urgencia las 24 horas.");
    expect(html).toContain("Disponible hoy");
    expect(html).toContain("+15");
    expect(html).toContain("4.9");
  });

  it("responsable tecnico derivado del lead + mapa embebido con URL segura", async () => {
    const html = await renderFinal("doc-urgencias.html");
    expect(html).toContain("Responsable Técnico:");
    expect(html).toContain("Dr. Carlos Adrian Cortes Victoria — Cédula profesional 120 0 70 41");
    expect(html).toContain("https://www.google.com/maps?q=");
    expect(html).toContain("&output=embed");
  });
});

/* ------------------------------------------------------------------ */
/* Visor web swipeable (doctor/_viewer.html)                           */
/* ------------------------------------------------------------------ */

describe("visor web doctor/_viewer.html (swipeable, lazy-load + toggle de marca)", () => {
  async function renderViewer(): Promise<string> {
    const template = await fs.readFile(path.join(TEMPLATES_DIR, "_viewer.html"), "utf8");
    return renderTemplate(template, {
      pages: [
        { file: "doc-clasico.html", name: "Clásico", audience: "Médicos" },
        { file: "doc-lujo.html", name: "Lujo", audience: "Premium" },
      ],
    });
  }

  it("no deja marcadores {{ }} sin resolver", async () => {
    const html = await renderViewer();
    expect(html).not.toMatch(/\{\{/);
  });

  it("los iframes cargan lazy (data-src), sin src= directo en el markup", async () => {
    const html = await renderViewer();
    expect(html).toContain('data-src="doc-clasico.html"');
    expect(html).toContain('data-src="doc-lujo.html"');
    expect(html).not.toMatch(/<iframe[^>]*\ssrc=/); // ningun iframe con src= de arranque
  });

  it("toggle de marca presente con el protocolo dc-brand + handshake dc-brand-ready", async () => {
    const html = await renderViewer();
    expect(html).toContain('id="brandBtn"');
    expect(html).toContain('"dc-brand"');
    expect(html).toContain("dc-brand-ready");
    // el handshake responde SOLO al iframe que avisa (clave con lazy-load)
    expect(html).toContain("ensureLoaded");
  });
});

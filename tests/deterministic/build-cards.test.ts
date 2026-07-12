import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertBuildableStatus,
  buildCardView,
  buildMapsUrl,
  hasGeneratedWebsite,
  injectBrandToggle,
  parseMotifs,
  socialUrl,
  swapMotif,
  type CardLink,
} from "../../src/stages/build-cards.js";
import { renderTemplate } from "../../src/lib/template.js";
import { StatusSchema, type Lead } from "../../src/lib/schema.js";

/**
 * Tests deterministas de build-cards: cubren la vista PURA (Lead -> objeto de
 * template, valida para cualquier diseno del pool), los helpers puros, el
 * guard de status y el render real de CADA template en `src/dc-templates/`.
 * El I/O de disco (readLead/writeArtifact/writeLead/readdir del pool) no se
 * testea aca a proposito.
 */

/** Lead verificado calcado del ground-truth real `prueba-karey`. */
function verifiedLead(overrides: Partial<Lead> = {}): Lead {
  return {
    slug: "prueba-karey",
    status: "verified",
    rubro: "doctor",
    source: {
      card_front: "card_front.jpg",
      card_back: "card_back.jpg",
      ingested_at: "2026-07-06T23:55:21.702Z",
      channel: "manual",
    },
    business: {
      name: "Torre Médica Universidad",
      person_name: "Dr. Guillermo Karey Pérez Cortés",
      tagline: "Cardiólogo Intervencionista",
      attrs: {},
    },
    contact: {
      phones: ["951 544 21 92"],
      address: "Torre Médica Universidad\nPiso 8, Consultorio 808\nAv Universidad #100\nEx Hacienda Candiani, Oaxaca",
    },
    socials: {},
    brand: {
      colors: { primary: "#24376d", secondary: "#352122", accent: "#d1857c" },
      colorsText: { primary: "#ffffff", secondary: "#ffffff", accent: "#000000" },
      has_logo: true,
      font_hint: "serif",
    },
    content: {
      services: [
        "Cateterismo cardíaco",
        "Angioplastia con stent",
        "TAVI",
        "Marcapasos",
        "Infarto del corazón",
        "Angina de pecho",
        "Válvulas cardiacas",
        "Consultas",
        "Electrocardiograma",
        "Ecocardiograma",
        "Holter",
        "MAPA",
      ],
    },
    generated: {},
    meta: { needs: [], errors: [], updated_at: "2026-07-08T01:03:18.945Z" },
    ...overrides,
  };
}

function links(view: Record<string, unknown>): CardLink[] {
  return view.links as CardLink[];
}

function linkOfKind(view: Record<string, unknown>, kind: string): CardLink | undefined {
  return links(view).find((l) => l.kind === kind);
}

describe("buildCardView — WhatsApp", () => {
  it("deriva WhatsApp de phones[0] cuando no hay whatsapp explicito, con codigo de pais", () => {
    const view = buildCardView(verifiedLead());
    const wa = linkOfKind(view, "whatsapp");
    expect(wa).toBeDefined();
    expect(wa!.url).toMatch(/^https:\/\/wa\.me\/529515442192\?text=/);
    expect(wa!.primary).toBe(true);
  });

  it("el CTA fijo (view.whatsapp) usa la misma URL derivada", () => {
    const view = buildCardView(verifiedLead());
    expect((view.whatsapp as { url: string }).url).toMatch(/^https:\/\/wa\.me\/529515442192/);
  });

  it("respeta el whatsapp explicito que ya trae codigo de pais (no lo duplica)", () => {
    const lead = verifiedLead();
    lead.contact.whatsapp = "+52 951 544 21 92";
    const view = buildCardView(lead);
    expect(linkOfKind(view, "whatsapp")!.url).toMatch(/wa\.me\/529515442192\?/);
  });

  it("antepone el codigo de pais a un whatsapp explicito local (10 digitos)", () => {
    const lead = verifiedLead();
    lead.contact.whatsapp = "951 111 22 33";
    const view = buildCardView(lead);
    expect(linkOfKind(view, "whatsapp")!.url).toMatch(/wa\.me\/529511112233\?/);
  });

  it("sin telefonos ni whatsapp: no hay boton ni CTA fijo", () => {
    const lead = verifiedLead({ contact: { address: "Calle 1" } });
    const view = buildCardView(lead);
    expect(linkOfKind(view, "whatsapp")).toBeUndefined();
    expect(view.whatsapp).toBeNull();
  });
});

describe("buildCardView — botones por datos presentes/ausentes (diseno credencial)", () => {
  it("un telefono => boton 'Llamar' con tel: de solo digitos", () => {
    const view = buildCardView(verifiedLead());
    const phone = linkOfKind(view, "phone");
    expect(phone!.label).toBe("Llamar");
    expect(phone!.url).toBe("tel:9515442192");
  });

  it("varios telefonos => 'Llamar 1..N', un boton por numero", () => {
    const lead = verifiedLead({
      contact: { phones: ["951 111 11 11", "+52 951 222 22 22"] },
    });
    const view = buildCardView(lead);
    const phones = links(view).filter((l) => l.kind === "phone");
    expect(phones.map((p) => p.label)).toEqual(["Llamar 1", "Llamar 2"]);
    expect(phones.map((p) => p.url)).toEqual(["tel:9511111111", "tel:+529512222222"]);
  });

  it("email y sitio web solo si existen", () => {
    const sin = buildCardView(verifiedLead());
    expect(linkOfKind(sin, "email")).toBeUndefined();
    expect(linkOfKind(sin, "website")).toBeUndefined();

    const lead = verifiedLead();
    lead.contact.email = "hola@karey.mx";
    lead.contact.website = "https://karey.mx";
    const con = buildCardView(lead);
    expect(linkOfKind(con, "email")!.url).toBe("mailto:hola@karey.mx");
    expect(linkOfKind(con, "website")!.url).toBe("https://karey.mx");
  });

  it("redes: handle pelado se normaliza a URL canonica", () => {
    const lead = verifiedLead({
      socials: { instagram: "@drkarey", facebook: "drkarey.fb", tiktok: "drkarey" },
    });
    const view = buildCardView(lead);
    expect(linkOfKind(view, "instagram")!.url).toBe("https://www.instagram.com/drkarey");
    expect(linkOfKind(view, "facebook")!.url).toBe("https://www.facebook.com/drkarey.fb");
    expect(linkOfKind(view, "tiktok")!.url).toBe("https://www.tiktok.com/@drkarey");
  });

  it("sin dato alguno de contacto ni nombre: sin links y hasLinks=false", () => {
    const lead = verifiedLead({
      business: { name: "", attrs: {} },
      contact: {},
      socials: {},
    });
    const view = buildCardView(lead);
    expect(links(view)).toEqual([]);
    expect(view.hasLinks).toBe(false);
  });

  it("todo link lleva icono SVG inline", () => {
    const lead = verifiedLead();
    lead.contact.email = "hola@karey.mx";
    const view = buildCardView(lead);
    for (const l of links(view)) expect(l.icon).toContain("<svg");
  });
});

describe("socialUrl / buildMapsUrl", () => {
  it("respeta URLs completas tal cual", () => {
    expect(socialUrl("instagram", "https://instagram.com/drkarey")).toBe("https://instagram.com/drkarey");
  });

  it("maps: junta lineas con coma y encodea", () => {
    const url = buildMapsUrl("Torre Médica\nPiso 8\nOaxaca");
    expect(url).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Torre Médica, Piso 8, Oaxaca")}`,
    );
  });
});

describe("buildCardView — direccion (diseno credencial)", () => {
  it("expone las lineas de la direccion y la URL de maps", () => {
    const view = buildCardView(verifiedLead());
    const address = view.address as { lines: string[]; mapsUrl: string };
    expect(address.lines).toEqual([
      "Torre Médica Universidad",
      "Piso 8, Consultorio 808",
      "Av Universidad #100",
      "Ex Hacienda Candiani, Oaxaca",
    ]);
    expect(address.mapsUrl).toContain("google.com/maps/search/?api=1&query=");
    expect(address.mapsUrl).toContain(encodeURIComponent("Piso 8, Consultorio 808"));
  });

  it("sin direccion: address es null", () => {
    const lead = verifiedLead({ contact: { phones: ["951 544 21 92"] } });
    expect(buildCardView(lead).address).toBeNull();
  });
});

describe("buildCardView — tema (colores + colorsText)", () => {
  it("usa los colores medidos y su colorsText WCAG tal cual (no recalcula)", () => {
    const view = buildCardView(verifiedLead());
    expect(view.colors).toEqual({ primary: "#24376d", secondary: "#352122", accent: "#d1857c" });
    expect(view.colorsText).toEqual({ primary: "#ffffff", secondary: "#ffffff", accent: "#000000" });
  });

  it("sin colores medidos: cae al par completo de reserva (color+texto juntos)", () => {
    const lead = verifiedLead();
    lead.brand = { colors: {}, has_logo: false };
    const view = buildCardView(lead);
    expect(view.colors).toEqual({ primary: "#111827", secondary: "#374151", accent: "#2563eb" });
    expect(view.colorsText).toEqual({ primary: "#ffffff", secondary: "#ffffff", accent: "#ffffff" });
  });

  it("color medido sin colorsText (data.json viejo): texto de reserva, color intacto", () => {
    const lead = verifiedLead();
    lead.brand = { colors: { primary: "#24376d" }, has_logo: false };
    const view = buildCardView(lead);
    expect((view.colors as Record<string, string>).primary).toBe("#24376d");
    expect((view.colorsText as Record<string, string>).primary).toBe("#ffffff");
  });

  it("expone background/surface/text medidos con sus flags hasX (roles opcionales)", () => {
    const lead = verifiedLead();
    lead.brand = {
      colors: {
        primary: "#24376d",
        secondary: "#352122",
        accent: "#d1857c",
        background: "#f4efe6",
        surface: "#e7ddc9",
        text: "#1a1a1a",
      },
      colorsText: {
        primary: "#ffffff",
        secondary: "#ffffff",
        accent: "#000000",
        background: "#000000",
        surface: "#000000",
      },
      has_logo: true,
      font_hint: "serif",
    };
    const view = buildCardView(lead);
    const colors = view.colors as Record<string, string>;
    expect(colors.background).toBe("#f4efe6");
    expect(colors.surface).toBe("#e7ddc9");
    expect(colors.text).toBe("#1a1a1a");
    expect(view.hasBackground).toBe(true);
    expect(view.hasSurface).toBe(true);
    expect(view.hasText).toBe(true);
    // background/surface son superficie => llevan colorsText; text es TINTA => no.
    const colorsText = view.colorsText as Record<string, string>;
    expect(colorsText.background).toBe("#000000");
    expect(colorsText.surface).toBe("#000000");
    expect(colorsText.text).toBeUndefined();
  });

  it("background/surface/text ausentes (tarjeta blanca: ignoreWhite descarta el fondo): flags en false, sin clave", () => {
    const view = buildCardView(verifiedLead()); // el fixture no trae estos roles
    expect(view.hasBackground).toBe(false);
    expect(view.hasSurface).toBe(false);
    expect(view.hasText).toBe(false);
    const colors = view.colors as Record<string, string>;
    expect(colors.background).toBeUndefined();
    expect(colors.surface).toBeUndefined();
    expect(colors.text).toBeUndefined();
    // no debe contaminar el bloque p/s/a que ya consumen las cards
    expect(colors).toEqual({ primary: "#24376d", secondary: "#352122", accent: "#d1857c" });
  });

  it("superficie medida sin colorsText (data.json viejo): deriva el texto WCAG con textColorFor", () => {
    const lead = verifiedLead();
    lead.brand = { colors: { surface: "#0b0b0d" }, has_logo: false }; // superficie oscura => texto claro
    const view = buildCardView(lead);
    expect((view.colorsText as Record<string, string>).surface).toBe("#ffffff");
    expect(view.hasSurface).toBe(true);
  });
});

describe("buildCardView — tipografia por font_hint (diseno credencial)", () => {
  it("serif => stack serif (Georgia)", () => {
    const view = buildCardView(verifiedLead());
    expect(view.fontFamily).toContain("Georgia");
    expect(view.fontFamily).toMatch(/serif$/);
  });

  it("case-insensitive: 'SERIF' funciona igual", () => {
    const lead = verifiedLead();
    lead.brand.font_hint = "SERIF";
    expect(buildCardView(lead).fontFamily).toContain("Georgia");
  });

  it("display => stack con caracter", () => {
    const lead = verifiedLead();
    lead.brand.font_hint = "display";
    expect(buildCardView(lead).fontFamily).toContain("Trebuchet MS");
  });

  it("hint desconocido o ausente => fallback sans (system-ui)", () => {
    const raro = verifiedLead();
    raro.brand.font_hint = "gotica";
    expect(buildCardView(raro).fontFamily).toContain("system-ui");

    const sinHint = verifiedLead();
    delete sinHint.brand.font_hint;
    expect(buildCardView(sinHint).fontFamily).toContain("system-ui");
  });
});

describe("buildCardView — identidad y extras", () => {
  it("expone name, personName, tagline y pageTitle compuesto (credencial)", () => {
    const view = buildCardView(verifiedLead());
    expect(view.name).toBe("Torre Médica Universidad");
    expect(view.personName).toBe("Dr. Guillermo Karey Pérez Cortés");
    expect(view.tagline).toBe("Cardiólogo Intervencionista");
    expect(view.pageTitle).toBe("Torre Médica Universidad — Cardiólogo Intervencionista");
  });

  it("avatar: inicial del negocio si no hay logo_path (has_logo true no alcanza)", () => {
    const view = buildCardView(verifiedLead());
    expect(view.initial).toBe("T");
    expect(view.logoPath).toBe("");
  });

  it("avatar: logo_path pasa tal cual cuando existe", () => {
    const lead = verifiedLead();
    lead.brand.logo_path = "logo.png";
    expect(buildCardView(lead).logoPath).toBe("logo.png");
  });

  it("avatar: photo_path pasa tal cual y coexiste con logo_path (prioridad la da el template)", () => {
    const lead = verifiedLead();
    lead.brand.photo_path = "foto.jpg";
    lead.brand.logo_path = "logo.png";
    const view = buildCardView(lead);
    expect(view.photoPath).toBe("foto.jpg");
    expect(view.logoPath).toBe("logo.png");
  });

  it("avatar: sin photo_path, photoPath queda vacio (cascada cae al logo o a la inicial)", () => {
    expect(buildCardView(verifiedLead()).photoPath).toBe("");
  });

  it("sin nombre de negocio la inicial cae a la persona", () => {
    const lead = verifiedLead();
    lead.business.name = "";
    expect(buildCardView(lead).initial).toBe("D");
  });

  it("JSON-LD: tipo por rubro, parseable, con telefono y direccion", () => {
    const view = buildCardView(verifiedLead());
    const data = JSON.parse(view.jsonLd as string);
    expect(data["@type"]).toBe("Physician");
    expect(data.telephone).toBe("951 544 21 92");
    expect(data.address.streetAddress).toContain("Torre Médica Universidad");

    const otro = buildCardView(verifiedLead({ rubro: "otro" }));
    expect(JSON.parse(otro.jsonLd as string)["@type"]).toBe("LocalBusiness");
  });

  it("JSON-LD: '<' queda escapado (nadie puede cerrar el <script>)", () => {
    const lead = verifiedLead();
    lead.business.name = "Negocio </script><script>";
    const jsonLd = buildCardView(lead).jsonLd as string;
    expect(jsonLd).not.toContain("</script>");
    expect(jsonLd).toContain("\\u003c");
    expect(() => JSON.parse(jsonLd)).not.toThrow();
  });

  it("year es parametro (determinista en tests)", () => {
    expect(buildCardView(verifiedLead(), 2030).year).toBe(2030);
  });

  it("servicios pasan enteros; sin servicios hasServices=false", () => {
    const view = buildCardView(verifiedLead());
    expect((view.services as string[]).length).toBe(12);
    expect(view.hasServices).toBe(true);

    const vacio = buildCardView(verifiedLead({ content: { services: [] } }));
    expect(vacio.hasServices).toBe(false);
  });
});

describe("buildCardView — campos planos para los disenos nuevos (clinic/dark/executive/luxury)", () => {
  it("heroName prioriza persona sobre negocio sobre slug", () => {
    expect(buildCardView(verifiedLead()).heroName).toBe("Dr. Guillermo Karey Pérez Cortés");

    const sinPersona = verifiedLead();
    sinPersona.business.person_name = undefined;
    expect(buildCardView(sinPersona).heroName).toBe("Torre Médica Universidad");

    const sinNada = verifiedLead();
    sinNada.business.person_name = undefined;
    sinNada.business.name = "";
    expect(buildCardView(sinNada).heroName).toBe("prueba-karey");
  });

  it("hasOrgLine solo si business.name aporta algo distinto del heroName", () => {
    expect(buildCardView(verifiedLead()).hasOrgLine).toBe(true);

    const sinPersona = verifiedLead();
    sinPersona.business.person_name = undefined; // heroName cae a business.name
    const view = buildCardView(sinPersona);
    expect(view.heroName).toBe(view.orgName); // heroName === orgName
    expect(view.hasOrgLine).toBe(false); // no se duplica en la linea de org
  });

  it("hasPhone/whatsappUrl/phoneTelHref/phoneDisplay usan el primer telefono", () => {
    const view = buildCardView(verifiedLead());
    expect(view.hasPhone).toBe(true);
    expect(view.phoneDisplay).toBe("951 544 21 92");
    expect(view.phoneTelHref).toBe("tel:9515442192");
    expect(view.whatsappUrl).toMatch(/^https:\/\/wa\.me\/529515442192\?text=/);

    const sinTel = buildCardView(verifiedLead({ contact: {} }));
    expect(sinTel.hasPhone).toBe(false);
    expect(sinTel.phoneTelHref).toBe("");
  });

  it("mapsUrl y addressLine solo si hay direccion", () => {
    const view = buildCardView(verifiedLead());
    expect(view.hasAddressLine).toBe(true);
    expect(view.addressLine).toBe("Torre Médica Universidad, Piso 8, Consultorio 808, Av Universidad #100, Ex Hacienda Candiani, Oaxaca");
    expect(view.mapsUrl).toContain("google.com/maps/search/?api=1&query=");

    const sinDireccion = buildCardView(verifiedLead({ contact: { phones: ["951 544 21 92"] } }));
    expect(sinDireccion.hasAddressLine).toBe(false);
    expect(sinDireccion.mapsUrl).toBe("");
  });

  it("attrs: Record<string,string> de business.attrs se convierte en lista {key,value}; vacio => hasAttrs=false", () => {
    const sinAttrs = buildCardView(verifiedLead());
    expect(sinAttrs.hasAttrs).toBe(false);
    expect(sinAttrs.attrs).toEqual([]);

    const conAttrs = buildCardView(
      verifiedLead({ business: { name: "X", attrs: { Experiencia: "12 años", Idiomas: "Español" } } }),
    );
    expect(conAttrs.hasAttrs).toBe(true);
    expect(conAttrs.attrs).toEqual([
      { key: "Experiencia", value: "12 años" },
      { key: "Idiomas", value: "Español" },
    ]);
  });

  it("servicesNumbered: numeracion 01, 02... para el diseno executive", () => {
    const view = buildCardView(verifiedLead({ content: { services: ["A", "B", "C"] } }));
    expect(view.servicesNumbered).toEqual([
      { n: "01", name: "A" },
      { n: "02", name: "B" },
      { n: "03", name: "C" },
    ]);
  });

  it("hasSocials es true si al menos una red esta presente; false si ninguna", () => {
    expect(buildCardView(verifiedLead()).hasSocials).toBe(false);

    const conInsta = buildCardView(verifiedLead({ socials: { instagram: "drkarey" } }));
    expect(conInsta.hasSocials).toBe(true);
    expect(conInsta.hasInstagram).toBe(true);
    expect(conInsta.hasFacebook).toBe(false);
    expect(conInsta.instagramUrl).toBe("https://www.instagram.com/drkarey");
  });
});

describe("assertBuildableStatus — guard", () => {
  it("rechaza ingested y extracted con mensaje claro", () => {
    expect(() => assertBuildableStatus("ingested")).toThrow(/verified/);
    expect(() => assertBuildableStatus("extracted")).toThrow(/verify/);
  });

  it("rechaza error aunque en el enum quede despues de verified", () => {
    expect(() => assertBuildableStatus("error")).toThrow(/error/);
  });

  it("acepta verified y todos los estados posteriores del camino feliz", () => {
    const order = StatusSchema.options;
    const desdeVerified = order.slice(order.indexOf("verified")).filter((s) => s !== "error");
    for (const status of desdeVerified) {
      expect(() => assertBuildableStatus(status)).not.toThrow();
    }
  });
});

describe("hasGeneratedWebsite — gate del link \"Ver mi sitio\" (build-cards corre ANTES que build-web)", () => {
  it("false antes de que build-web corra (verified/linktree_built/enriched)", () => {
    expect(hasGeneratedWebsite("verified")).toBe(false);
    expect(hasGeneratedWebsite("linktree_built")).toBe(false);
    expect(hasGeneratedWebsite("enriched")).toBe(false);
  });

  it("true desde web_built en adelante (build-web ya corrio)", () => {
    expect(hasGeneratedWebsite("web_built")).toBe(true);
    expect(hasGeneratedWebsite("deployed")).toBe(true);
    expect(hasGeneratedWebsite("proposal_ready")).toBe(true);
    expect(hasGeneratedWebsite("packaged")).toBe(true);
  });

  it("false en ingested/extracted; excluye error aunque quede despues en el enum", () => {
    expect(hasGeneratedWebsite("ingested")).toBe(false);
    expect(hasGeneratedWebsite("extracted")).toBe(false);
    expect(hasGeneratedWebsite("error")).toBe(false);
  });
});

describe("buildCardView — \"Ver mi sitio\" (mini-web generada por build-web, distinta de contact.website)", () => {
  it("sin web generada todavia (status verified): hasGeneratedWeb false, generatedWebUrl vacio, sin link en el pool generico", () => {
    const view = buildCardView(verifiedLead());
    expect(view.hasGeneratedWeb).toBe(false);
    expect(view.generatedWebUrl).toBe("");
    expect(linkOfKind(view, "generated-web")).toBeUndefined();
  });

  it("con web generada (status web_built o posterior): hasGeneratedWeb true, URL relativa a la carpeta hermana web/", () => {
    const view = buildCardView(verifiedLead({ status: "web_built" }));
    expect(view.hasGeneratedWeb).toBe(true);
    expect(view.generatedWebUrl).toBe("../web/");
    const link = linkOfKind(view, "generated-web");
    expect(link).toBeDefined();
    expect(link!.label).toBe("Ver mi sitio");
    expect(link!.url).toBe("../web/");
    expect(link!.external).toBe(true);
  });

  it("coexiste con el sitio PROPIO del negocio (contact.website): son dos links distintos", () => {
    const lead = verifiedLead({ status: "deployed" });
    lead.contact.website = "https://elnegocio-ya-tenia.mx";
    const view = buildCardView(lead);
    expect(linkOfKind(view, "website")!.url).toBe("https://elnegocio-ya-tenia.mx");
    expect(linkOfKind(view, "generated-web")!.url).toBe("../web/");
  });
});

describe("render del diseno credencial (contrato vista <-> HTML, self-contained)", () => {
  async function renderKarey(): Promise<string> {
    const url = new URL("../../src/dc-templates/credencial.html", import.meta.url);
    const template = await fs.readFile(fileURLToPath(url), "utf8");
    return renderTemplate(template, buildCardView(verifiedLead(), 2026));
  }

  it("inyecta paleta medida, colorsText y tipografia serif en el CSS", async () => {
    const html = await renderKarey();
    expect(html).toContain("--primary: #24376d");
    expect(html).toContain("--accent: #d1857c");
    expect(html).toContain("--accent-text: #000000");
    expect(html).toContain("Georgia");
  });

  it("renderiza CTA de WhatsApp derivado y los 12 servicios", async () => {
    const html = await renderKarey();
    expect(html).toContain("wa.me/529515442192");
    expect(html).toContain('class="cta"');
    expect(html).toContain("Cateterismo cardíaco");
    expect(html).toContain("MAPA");
  });

  it("muestra persona, tagline, direccion con maps y avatar de inicial", async () => {
    const html = await renderKarey();
    expect(html).toContain("Dr. Guillermo Karey Pérez Cortés");
    expect(html).toContain("Cardiólogo Intervencionista");
    expect(html).toContain("google.com/maps/search/?api=1&amp;query=");
    expect(html).toContain(">T</div>");
    expect(html).not.toContain("undefined");
  });

  it("es self-contained: sin fetch externo (http solo en href/schema.org)", async () => {
    const html = await renderKarey();
    expect(html).not.toContain("fonts.googleapis");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("<script src");
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
  });
});

describe("render de cada diseno nuevo del pool (clinic/dark/executive/luxury)", () => {
  const NEW_DESIGNS = ["clinic", "dark", "executive", "luxury"];

  async function renderDesign(key: string): Promise<string> {
    const url = new URL(`../../src/dc-templates/${key}.html`, import.meta.url);
    const template = await fs.readFile(fileURLToPath(url), "utf8");
    return renderTemplate(template, buildCardView(verifiedLead(), 2026));
  }

  it.each(NEW_DESIGNS)("%s: no deja marcadores {{ }} sin resolver y sin 'undefined'", async (key) => {
    const html = await renderDesign(key);
    expect(html).not.toMatch(/\{\{/);
    expect(html).not.toContain("undefined");
  });

  it.each(NEW_DESIGNS)("%s: muestra persona/negocio, WhatsApp y colores medidos", async (key) => {
    const html = await renderDesign(key);
    expect(html).toContain("Dr. Guillermo Karey Pérez Cortés");
    expect(html).toContain("wa.me/529515442192");
    expect(html).toContain("#24376d");
  });

  it.each(NEW_DESIGNS)("%s: trae su propia fuente de Google Fonts (excepcion aceptada, no self-contained)", async (key) => {
    const html = await renderDesign(key);
    expect(html).toContain("fonts.googleapis.com");
  });

  it("clinic/dark/executive/luxury omiten booking, linkedin y youtube (no estan en el schema)", async () => {
    for (const key of NEW_DESIGNS) {
      const html = await renderDesign(key);
      expect(html).not.toContain("Reservar");
      expect(html).not.toContain("linkedin.com");
      expect(html).not.toContain("youtube.com");
    }
  });

  it("executive numera los servicios 01, 02...", async () => {
    const html = await renderDesign("executive");
    expect(html).toContain("<i>01</i>Cateterismo cardíaco");
  });

  it("sin redes sociales: la seccion de socials no aparece en ningun diseno", async () => {
    const lead = verifiedLead({ socials: {} });
    for (const key of NEW_DESIGNS) {
      const url = new URL(`../../src/dc-templates/${key}.html`, import.meta.url);
      const template = await fs.readFile(fileURLToPath(url), "utf8");
      const html = renderTemplate(template, buildCardView(lead, 2026));
      expect(html).not.toContain('aria-label="Redes sociales"');
    }
  });
});

describe("render del pool decorativo (celeste/vitrina/rotulo/seda/redondo/lienzo)", () => {
  const DECOR = ["celeste", "vitrina", "rotulo", "seda", "redondo", "lienzo"];

  async function loadDecor(key: string): Promise<string> {
    const url = new URL(`../../src/dc-templates/${key}.html`, import.meta.url);
    return fs.readFile(fileURLToPath(url), "utf8");
  }

  async function renderDecor(key: string, lead: Lead = verifiedLead()): Promise<string> {
    return renderTemplate(await loadDecor(key), buildCardView(lead, 2026));
  }

  it.each(DECOR)("%s: render limpio (sin {{ }} sin resolver ni 'undefined')", async (key) => {
    const html = await renderDecor(key);
    expect(html).not.toMatch(/\{\{/);
    expect(html).not.toContain("undefined");
  });

  it.each(DECOR)("%s: persona, WhatsApp derivado y colores medidos", async (key) => {
    const html = await renderDecor(key);
    expect(html).toContain("Dr. Guillermo Karey Pérez Cortés");
    expect(html).toContain("wa.me/529515442192");
    expect(html).toContain("#24376d");
  });

  it.each(DECOR)("%s: trae su propia Google Font (excepcion aceptada, no self-contained)", async (key) => {
    expect(await loadDecor(key)).toContain("fonts.googleapis.com");
  });

  it.each(DECOR)("%s: sin foto ni logo el avatar cae a la inicial", async (key) => {
    const html = await renderDecor(key);
    expect(html).toContain("avatar-ini");
    expect(html).toContain(">T</div>");
  });

  it.each(DECOR)("%s: con photo_path la foto entra en el avatar (prioridad sobre logo/inicial)", async (key) => {
    const lead = verifiedLead();
    lead.brand.photo_path = "foto-karey.jpg";
    const html = await renderDecor(key, lead);
    expect(html).toContain('src="foto-karey.jpg"');
  });

  it.each(DECOR)("%s: trae la capa de motivos con sus marcadores (fondo intercambiable)", async (key) => {
    const raw = await loadDecor(key);
    expect(raw).toContain("MOTIF:START");
    expect(raw).toContain("MOTIF:END");
  });
});

describe("render de los disenos Guelaguetza (paleta fija + assets propios)", () => {
  const GUELA = ["guelaguetza-calenda", "guelaguetza-pina", "guelaguetza-tehuana"];

  async function loadGuela(key: string): Promise<string> {
    const url = new URL(`../../src/dc-templates/${key}.html`, import.meta.url);
    return fs.readFile(fileURLToPath(url), "utf8");
  }

  async function renderGuela(key: string, lead: Lead = verifiedLead()): Promise<string> {
    return renderTemplate(await loadGuela(key), buildCardView(lead, 2026));
  }

  it.each(GUELA)("%s: render limpio (sin {{ }} sin resolver ni 'undefined')", async (key) => {
    const html = await renderGuela(key);
    expect(html).not.toMatch(/\{\{/);
    expect(html).not.toContain("undefined");
  });

  it.each(GUELA)("%s: muestra los datos del lead (persona + WhatsApp derivado)", async (key) => {
    const html = await renderGuela(key);
    expect(html).toContain("Dr. Guillermo Karey Pérez Cortés");
    expect(html).toContain("wa.me/529515442192");
  });

  it.each(GUELA)("%s: la paleta FIJA de :root no cambia con el lead (arte de color fijo, estatico por rubro)", async (key) => {
    const html = await renderGuela(key);
    const idx = html.indexOf(":root[data-brand]");
    expect(idx).toBeGreaterThan(-1);
    const rootBlock = html.slice(0, idx);
    expect(rootBlock).not.toContain("#24376d"); // el primary medido no entra en la paleta fija (default, toggle OFF)
  });

  it.each(GUELA)("%s: :root[data-brand] SI mapea el primary medido (toggle 'colores de tu marca' ON)", async (key) => {
    const html = await renderGuela(key);
    const idx = html.indexOf(":root[data-brand]");
    const brandBlock = html.slice(idx);
    expect(brandBlock).toContain("#24376d"); // el primary medido del fixture
  });

  it.each(GUELA)("%s: referencia sus assets exclusivos por ruta relativa (dc/assets/)", async (key) => {
    const html = await renderGuela(key);
    expect(html).toContain('src="assets/guelaguetza/');
  });

  it.each(GUELA)("%s: conserva la capa de motivos (swap por rubro con color fijo)", async (key) => {
    const raw = await loadGuela(key);
    expect(raw).toContain("MOTIF:START");
    expect(raw).toContain("MOTIF:END");
  });

  it.each(GUELA)("%s: avatar con la misma cascada foto -> logo -> inicial", async (key) => {
    const sinFoto = await renderGuela(key);
    expect(sinFoto).toContain("avatar-ini");
    expect(sinFoto).toContain(">T</div>");

    const lead = verifiedLead();
    lead.brand.photo_path = "foto-karey.jpg";
    const conFoto = await renderGuela(key, lead);
    expect(conFoto).toContain('src="foto-karey.jpg"');
  });
});

describe("\"Ver mi sitio\" en TODO el pool (14 disenos): gateado por status, URL relativa a web/", () => {
  const ALL_TEMPLATES = [
    "credencial",
    "clinic",
    "dark",
    "executive",
    "luxury",
    "celeste",
    "vitrina",
    "rotulo",
    "seda",
    "redondo",
    "lienzo",
    "guelaguetza-calenda",
    "guelaguetza-pina",
    "guelaguetza-tehuana",
  ];

  async function renderTemplateFor(key: string, lead: Lead): Promise<string> {
    const url = new URL(`../../src/dc-templates/${key}.html`, import.meta.url);
    const template = await fs.readFile(fileURLToPath(url), "utf8");
    return renderTemplate(template, buildCardView(lead, 2026));
  }

  it.each(ALL_TEMPLATES)("%s: NO muestra 'Ver mi sitio' antes de build-web (status verified)", async (key) => {
    const html = await renderTemplateFor(key, verifiedLead());
    expect(html).not.toContain("Ver mi sitio");
  });

  it.each(ALL_TEMPLATES)(
    "%s: SI muestra 'Ver mi sitio' con href relativo '../web/' una vez que build-web corrio (status web_built)",
    async (key) => {
      const html = await renderTemplateFor(key, verifiedLead({ status: "web_built" }));
      expect(html).toContain("Ver mi sitio");
      expect(html).toContain('href="../web/"');
    },
  );

  it.each(ALL_TEMPLATES)("%s: sin rastro de 'Guardar contacto' / vCard (funcionalidad removida)", async (key) => {
    const html = await renderTemplateFor(key, verifiedLead());
    expect(html.toLowerCase()).not.toContain("vcard");
    expect(html).not.toContain("Guardar contacto");
  });
});

describe("motivos por rubro — parseMotifs / swapMotif (fondo intercambiable)", () => {
  const RUBROS = ["doctor", "nutriologo", "barberia", "estetica", "veterinario", "otro"];

  async function motifsHtml(): Promise<string> {
    const url = new URL("../../src/dc-templates/_motifs.html", import.meta.url);
    return fs.readFile(fileURLToPath(url), "utf8");
  }
  async function templateHtml(key: string): Promise<string> {
    const url = new URL(`../../src/dc-templates/${key}.html`, import.meta.url);
    return fs.readFile(fileURLToPath(url), "utf8");
  }

  it("parseMotifs extrae un bloque por cada rubro, cada uno con sus 5 sprites", async () => {
    const motifs = parseMotifs(await motifsHtml());
    for (const r of RUBROS) {
      expect(motifs[r]).toBeDefined();
      expect(motifs[r]).toContain(`MOTIF:START (rubro=${r})`);
      expect(motifs[r]).toContain("MOTIF:END");
      const sprites = motifs[r]!.match(/class="m m[1-5]"/g) ?? [];
      expect(sprites).toHaveLength(5);
    }
  });

  it("swapMotif reemplaza el bloque default del template por el del rubro pedido", async () => {
    const motifs = parseMotifs(await motifsHtml());
    const seda = await templateHtml("seda"); // default: estetica
    expect(seda).toContain("MOTIF:START (rubro=estetica)");

    const swapped = swapMotif(seda, motifs.veterinario);
    expect(swapped).toContain("MOTIF:START (rubro=veterinario)");
    expect(swapped).not.toContain("MOTIF:START (rubro=estetica)");
    // solo cambia la capa de motivos: el resto del diseno queda intacto
    expect(swapped).toContain("{{heroName}}");
    expect(swapped).toContain("fonts.googleapis.com");
  });

  it("swapMotif es no-op en disenos sin marcadores (credencial no trae motivos)", async () => {
    const motifs = parseMotifs(await motifsHtml());
    const credencial = await templateHtml("credencial");
    expect(credencial).not.toContain("MOTIF:START");
    expect(swapMotif(credencial, motifs.doctor)).toBe(credencial);
  });

  it("swapMotif con motifBlock undefined deja el template intacto", () => {
    const tpl = "<body><!-- MOTIF:START (rubro=doctor) --><div class=motif></div><!-- MOTIF:END --></body>";
    expect(swapMotif(tpl, undefined)).toBe(tpl);
  });

  it("swapMotif inserta el bloque literal aunque el SVG traiga '$' (replacer function, no patron)", () => {
    const tpl = "a<!-- MOTIF:START (rubro=x) -->OLD<!-- MOTIF:END -->b";
    const block = "<!-- MOTIF:START (rubro=y) --><path d='M$1 $&'/><!-- MOTIF:END -->";
    expect(swapMotif(tpl, block)).toBe(`a${block}b`);
  });
});

describe("render del visor (_viewer.html)", () => {
  it("arma un slide por card y no deja marcadores sin resolver", async () => {
    const url = new URL("../../src/dc-templates/_viewer.html", import.meta.url);
    const template = await fs.readFile(fileURLToPath(url), "utf8");
    const html = renderTemplate(template, {
      cards: [
        { file: "clinic.html", name: "Clinic", audience: "Salud · Médicos" },
        { file: "dark.html", name: "Dark", audience: "Barberías · Tattoo · Gym" },
      ],
    });
    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain('src="clinic.html"');
    expect(html).toContain('src="dark.html"');
    expect(html).toContain("data-name=\"Clinic\"");
    expect(html).toContain("startViewTransition");
  });

  it("trae el toggle 'Ver con los colores de tu marca' (icono compacto + toast) y hace broadcast por postMessage", async () => {
    const url = new URL("../../src/dc-templates/_viewer.html", import.meta.url);
    const template = await fs.readFile(fileURLToPath(url), "utf8");
    const html = renderTemplate(template, {
      cards: [{ file: "clinic.html", name: "Clinic", audience: "Salud · Médicos" }],
    });
    expect(html).toContain('id="brandBtn"');
    expect(html).toContain('aria-pressed="false"'); // default: toggle OFF (colores originales)
    expect(html).toContain('aria-label="Ver con los colores de tu marca"');
    expect(html).toContain('id="brandToast"');
    expect(html).toContain("dc-brand-ready");
    expect(html).toContain("postMessage({ type: \"dc-brand\"");
  });

  it("los dots se ventanean (maximo 3 visibles: DOT_WINDOW_RADIUS=1) para pools grandes", async () => {
    const url = new URL("../../src/dc-templates/_viewer.html", import.meta.url);
    const template = await fs.readFile(fileURLToPath(url), "utf8");
    const html = renderTemplate(template, {
      cards: [{ file: "clinic.html", name: "Clinic", audience: "" }],
    });
    expect(html).toContain("DOT_WINDOW_RADIUS = 1");
    expect(html).toContain("classList.toggle(\"edge\"");
  });

  it("la burbuja de marca es arrastrable (drag distingue de click) y arranca abajo del borde", async () => {
    const url = new URL("../../src/dc-templates/_viewer.html", import.meta.url);
    const template = await fs.readFile(fileURLToPath(url), "utf8");
    const html = renderTemplate(template, {
      cards: [{ file: "clinic.html", name: "Clinic", audience: "" }],
    });
    expect(html).toContain('id="brandToggle"');
    // arranca corrida hacia abajo para no tapar el menu "sandwich" del diseno
    expect(html).toContain("+ 68px)");
    // drag: supera un umbral, marca "dragging" y cancela el click si hubo drag
    expect(html).toContain("DRAG_THRESHOLD");
    expect(html).toContain('classList.add("dragging")');
    expect(html).toContain("stopImmediatePropagation");
  });

  it("trae la vista guiada (coach-marks) con los pasos base y el boton de reabrir", async () => {
    const url = new URL("../../src/dc-templates/_viewer.html", import.meta.url);
    const template = await fs.readFile(fileURLToPath(url), "utf8");
    const html = renderTemplate(template, {
      cards: [{ file: "clinic.html", name: "Clinic", audience: "" }],
    });
    expect(html).toContain('id="tour"');
    expect(html).toContain('id="helpBtn"');
    expect(html).toContain("cómo se vería tu tarjeta digital");
    expect(html).toContain("los colores de tu marca");
    expect(html).toContain("Otros diseños");
  });

  it("el paso 'tu propia página web' de la guia se muestra SOLO con hasGeneratedWeb", async () => {
    const url = new URL("../../src/dc-templates/_viewer.html", import.meta.url);
    const template = await fs.readFile(fileURLToPath(url), "utf8");
    const withWeb = renderTemplate(template, {
      cards: [{ file: "clinic.html", name: "Clinic", audience: "" }],
      hasGeneratedWeb: true,
    });
    const withoutWeb = renderTemplate(template, {
      cards: [{ file: "clinic.html", name: "Clinic", audience: "" }],
    });
    expect(withWeb).toContain("Tu propia página web");
    expect(withoutWeb).not.toContain("Tu propia página web");
    // ni con ni sin el paso quedan marcadores sin resolver
    expect(withWeb).not.toMatch(/\{\{/);
    expect(withoutWeb).not.toMatch(/\{\{/);
  });
});

/**
 * Toggle "Ver con los colores de tu marca": cada card configurable declara
 * DOS paletas — `:root` (ORIGINAL del diseno, hardcodeada, default con el
 * toggle OFF) y `:root[data-brand]` (paleta MEDIDA del lead, activada en
 * runtime por el visor via postMessage). Se testea la separacion de bloques
 * por indexOf/slice: el hex original debe estar SOLO antes de
 * ":root[data-brand]"; el hex medido debe estar SOLO en/despues de ese
 * bloque. injectBrandToggle (el listener que activa el atributo) se testea
 * aparte como funcion pura, igual que swapMotif.
 */
describe("toggle de marca — :root trae la paleta ORIGINAL, :root[data-brand] la paleta MEDIDA", () => {
  const ORIGINAL_PRIMARY: Record<string, string> = {
    clinic: "#344563",
    dark: "#15151a",
    executive: "#1f2733",
    luxury: "#2c2a26",
    credencial: "#484c6f",
    celeste: "#35315e",
    lienzo: "#3d3a35",
    redondo: "#1f7a6d",
    rotulo: "#16324f",
    seda: "#8a4f5b",
    vitrina: "#4a5d23",
  };

  async function renderAny(key: string): Promise<string> {
    const url = new URL(`../../src/dc-templates/${key}.html`, import.meta.url);
    const template = await fs.readFile(fileURLToPath(url), "utf8");
    return renderTemplate(template, buildCardView(verifiedLead(), 2026));
  }

  it.each(Object.keys(ORIGINAL_PRIMARY))(
    "%s: :root (antes del bloque de marca) trae el primary ORIGINAL hardcodeado",
    async (key) => {
      const html = await renderAny(key);
      const idx = html.indexOf(":root[data-brand]");
      expect(idx).toBeGreaterThan(-1);
      const rootBlock = html.slice(0, idx);
      expect(rootBlock).toContain(ORIGINAL_PRIMARY[key]!);
    },
  );

  it.each(Object.keys(ORIGINAL_PRIMARY))(
    "%s: :root[data-brand] trae el primary MEDIDO del lead (#24376d en el fixture)",
    async (key) => {
      const html = await renderAny(key);
      const idx = html.indexOf(":root[data-brand]");
      const brandBlock = html.slice(idx);
      expect(brandBlock).toContain("#24376d");
    },
  );
});

describe("injectBrandToggle — listener del toggle de marca (funcion pura de build-cards.ts)", () => {
  it("inserta el snippet justo antes de </body>", () => {
    const html = "<html><body><p>x</p></body></html>";
    const out = injectBrandToggle(html);
    expect(out).toContain("data-brand");
    expect(out).toContain("dc-brand-ready");
    expect(out).toContain("</script></body>");
  });

  it("hace append al final si no hay </body> (no deberia pasar, pero no pierde el listener en silencio)", () => {
    const html = "<html><p>x</p></html>";
    const out = injectBrandToggle(html);
    expect(out.startsWith(html)).toBe(true);
    expect(out).toContain("dc-brand-ready");
  });
});

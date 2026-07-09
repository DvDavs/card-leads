import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertBuildableStatus,
  buildCardView,
  buildMapsUrl,
  socialUrl,
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

  it("sin nombre de negocio la inicial cae a la persona", () => {
    const lead = verifiedLead();
    lead.business.name = "";
    expect(buildCardView(lead).initial).toBe("D");
  });

  it("vCard: data URI con FN, TEL y direccion escapada (RFC 6350)", () => {
    const view = buildCardView(verifiedLead());
    const vcardLink = linkOfKind(view, "vcard");
    expect(vcardLink!.download).toBe("prueba-karey.vcf");
    expect(vcardLink!.url.startsWith("data:text/vcard;charset=utf-8,")).toBe(true);
    const decoded = decodeURIComponent(vcardLink!.url.split(",")[1]!);
    expect(decoded).toContain("FN:Dr. Guillermo Karey Pérez Cortés");
    expect(decoded).toContain("ORG:Torre Médica Universidad");
    expect(decoded).toContain("TEL;TYPE=WORK,VOICE:9515442192");
    expect(decoded).toContain("Piso 8\\, Consultorio 808"); // coma escapada
    expect(decoded).toContain("END:VCARD");
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

  it("renderiza CTA de WhatsApp derivado, vCard descargable y los 12 servicios", async () => {
    const html = await renderKarey();
    expect(html).toContain("wa.me/529515442192");
    expect(html).toContain('class="cta"');
    expect(html).toContain('download="prueba-karey.vcf"');
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
});

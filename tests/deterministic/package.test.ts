import { describe, expect, it } from "vitest";
import {
  buildOutreachMessage,
  greetingName,
  publicCardUrl,
  publicWebUrl,
  PUBLIC_BASE_URL,
  UPSELL_SYSTEMS,
} from "../../src/lib/outreach.js";
import { assertPackageableStatus } from "../../src/stages/package.js";
import type { Lead } from "../../src/lib/schema.js";

/**
 * Tests deterministas de package/outreach: cubren SOLO las piezas puras (el
 * armado del mensaje y el guard de status). La escritura a disco de `pkg` no se
 * testea aca, igual que el resto de los stages.
 */

/** Lead ya con tarjetas generadas (status "linktree_built"), con overrides. */
function builtLead(overrides: Partial<Lead> = {}): Lead {
  return {
    slug: "dr-karey",
    status: "linktree_built",
    rubro: "doctor",
    source: {
      card_front: "card_front.jpg",
      ingested_at: "2026-07-03T00:00:00.000Z",
      channel: "manual",
    },
    business: {
      name: "DR. GUILLERMO KAREY",
      person_name: "Dr. Guillermo Karey Perez Cortes",
      tagline: "Cardiologo Intervencionista",
      attrs: {},
    },
    contact: { phones: ["951 544 21 92"] },
    socials: {},
    brand: {
      colors: { primary: "#4A2B2B" },
      has_logo: true,
    },
    content: { services: ["Cateterismo cardiaco"] },
    generated: { dc_url: "dc/index.html", cards: [{ template: "clinic", path: "dc/clinic.html" }] },
    meta: { needs: [], errors: [], updated_at: "2026-07-03T00:00:00.000Z" },
    ...overrides,
  };
}

describe("publicCardUrl / publicWebUrl", () => {
  it("arma la URL publica con dominio + slug + subcarpeta que sube deploy", () => {
    // el raiz <base>/<slug> NO resuelve: deploy publica en /dc/ y /web/
    expect(publicCardUrl("dr-karey")).toBe(`${PUBLIC_BASE_URL}/dr-karey/dc/`);
    expect(publicCardUrl("dr-karey")).toBe("https://cards.kronet.app/dr-karey/dc/");
    expect(publicWebUrl("dr-karey")).toBe("https://cards.kronet.app/dr-karey/web/");
  });
});

describe("greetingName", () => {
  it("prefiere el nombre de la persona", () => {
    expect(greetingName(builtLead())).toBe("Dr. Guillermo Karey Perez Cortes");
  });

  it("cae al nombre del negocio si no hay persona", () => {
    const lead = builtLead({
      business: { name: "Barberia El Corte", attrs: {} },
    });
    expect(greetingName(lead)).toBe("Barberia El Corte");
  });

  it("cae al placeholder [nombre] si no hay ni persona ni negocio", () => {
    const lead = builtLead({ business: { name: "", attrs: {} } });
    expect(greetingName(lead)).toBe("[nombre]");
  });
});

describe("buildOutreachMessage", () => {
  it("saluda con 'Hola, buen día' y el nombre del cliente", () => {
    const { front } = buildOutreachMessage(builtLead());
    expect(front).toContain("Hola, buen día Dr. Guillermo Karey Perez Cortes");
  });

  it("incluye el enlace publico de la tarjeta digital con el sufijo /dc/", () => {
    const { front, full } = buildOutreachMessage(builtLead());
    expect(front).toContain("📱 Tarjeta digital:\nhttps://cards.kronet.app/dr-karey/dc/");
    expect(full).toContain("https://cards.kronet.app/dr-karey/dc/");
  });

  it("incluye la pagina web solo si el lead ya la tiene, siempre con la URL canonica", () => {
    const sin = buildOutreachMessage(builtLead());
    expect(sin.front).not.toContain("Página web:");

    // web_url relativo (build-web sin deploy): es SENAL de que la web existe,
    // pero la URL del mensaje se deriva del slug, nunca de ese valor.
    const con = buildOutreachMessage(
      builtLead({
        generated: { dc_url: "dc/index.html", web_url: "web/index.html" },
      }),
    );
    expect(con.front).toContain("🌐 Página web:\nhttps://cards.kronet.app/dr-karey/web/");
    expect(con.front).not.toContain("web/index.html");
  });

  it("el back lista TODOS los sistemas del menu de up-sell", () => {
    const { back } = buildOutreachMessage(builtLead());
    for (const s of UPSELL_SYSTEMS) {
      expect(back).toContain(`• ${s}`);
    }
  });

  it("el back usa el propio entregable como prueba (se creo automaticamente desde una foto)", () => {
    const { back } = buildOutreachMessage(builtLead());
    expect(back).toContain("se creó automáticamente a partir de una fotografía");
  });

  it("el mensaje completo une apertura y seguimiento", () => {
    const { front, back, full } = buildOutreachMessage(builtLead());
    expect(full).toContain(front);
    expect(full).toContain(back);
  });

  it("usa 'su negocio' como fallback cuando no hay nombre de negocio", () => {
    const lead = builtLead({ business: { name: "", attrs: {} } });
    const { front, back } = buildOutreachMessage(lead);
    expect(front).toContain("Estuve en su negocio y tomé una foto");
    expect(back).toContain("estas herramientas en su negocio");
  });

  it("menciona el negocio por nombre en la apertura y el seguimiento", () => {
    const { front, back } = buildOutreachMessage(builtLead());
    expect(front).toContain("Estuve en DR. GUILLERMO KAREY y tomé una foto");
    expect(back).toContain("estas herramientas en DR. GUILLERMO KAREY");
  });
});

describe("assertPackageableStatus", () => {
  it("acepta 'linktree_built' y estados posteriores", () => {
    expect(() => assertPackageableStatus("linktree_built")).not.toThrow();
    expect(() => assertPackageableStatus("web_built")).not.toThrow();
    expect(() => assertPackageableStatus("packaged")).not.toThrow();
  });

  it("rechaza estados previos a build-cards", () => {
    expect(() => assertPackageableStatus("ingested")).toThrow(/build-cards/);
    expect(() => assertPackageableStatus("extracted")).toThrow();
    expect(() => assertPackageableStatus("verified")).toThrow();
  });

  it("rechaza 'error' aunque su indice quede despues en el enum", () => {
    expect(() => assertPackageableStatus("error")).toThrow();
  });
});

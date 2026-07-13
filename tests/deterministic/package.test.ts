import { describe, expect, it } from "vitest";
import {
  buildOutreachMessage,
  greetingName,
  publicCardUrl,
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

describe("publicCardUrl", () => {
  it("arma la URL publica con el dominio de kronet y el slug", () => {
    expect(publicCardUrl("dr-karey")).toBe(`${PUBLIC_BASE_URL}/dr-karey`);
    expect(publicCardUrl("dr-karey")).toBe("https://cards.kronet.app/dr-karey");
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

  it("incluye el enlace publico de la tarjeta digital", () => {
    const { front, full } = buildOutreachMessage(builtLead());
    expect(front).toContain("https://cards.kronet.app/dr-karey");
    expect(full).toContain("https://cards.kronet.app/dr-karey");
  });

  it("incluye el enlace del sitio web solo si el lead ya lo tiene", () => {
    const sin = buildOutreachMessage(builtLead());
    expect(sin.front).not.toContain("Sitio web:");

    const con = buildOutreachMessage(
      builtLead({
        generated: { dc_url: "dc/index.html", web_url: "https://cards.kronet.app/dr-karey/web" },
      }),
    );
    expect(con.front).toContain("🌐 Sitio web: https://cards.kronet.app/dr-karey/web");
  });

  it("el back lista TODOS los sistemas del menu de up-sell", () => {
    const { back } = buildOutreachMessage(builtLead());
    for (const s of UPSELL_SYSTEMS) {
      expect(back).toContain(s.name);
    }
  });

  it("el back usa el propio entregable como prueba (se generaron de forma automatica)", () => {
    const { back } = buildOutreachMessage(builtLead());
    expect(back).toContain("de forma automática");
  });

  it("el mensaje completo une apertura y seguimiento", () => {
    const { front, back, full } = buildOutreachMessage(builtLead());
    expect(full).toContain(front);
    expect(full).toContain(back);
  });

  it("usa 'su negocio' como fallback cuando no hay nombre de negocio", () => {
    const lead = builtLead({ business: { name: "", attrs: {} } });
    const { front } = buildOutreachMessage(lead);
    expect(front).toContain("Tomé la tarjeta de su negocio");
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

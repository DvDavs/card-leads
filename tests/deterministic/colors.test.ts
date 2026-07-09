import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractBrandColors,
  extractPalette,
  resolveAssignedColors,
  textColorFor,
} from "../../src/lib/colors.js";

/**
 * Tests deterministas de la medicion de color (colorthief lee pixeles reales, no
 * llama a ningun LLM). Corren sobre un fixture COMMITEADO — las fotos reales de
 * leads/ estan gitignoreadas (PII), asi que no sirven de fixture.
 *
 * El fixture tests/fixtures/card-front.png imita una tarjeta: fondo BLANCO con un
 * bloque azul saturado (#1d4ed8) y uno naranja (#f97316). Sirve para probar que
 * `ignoreWhite` descarta el fondo y la heuristica devuelve los colores de marca.
 */

const HEX6 = /^#[0-9a-f]{6}$/;

/** Ruta al fixture, resuelta contra este archivo (no contra el cwd). */
const FIXTURE = fileURLToPath(new URL("../fixtures/card-front.png", import.meta.url));
/** Fixture "tarjeta oscura" estilo Valentina: bloque OSCURO desaturado (#3e413e)
 * dominante + un gris-azul CLARO (#d2d9e2). El primary debe ser el oscuro. */
const DARK_FIXTURE = fileURLToPath(new URL("../fixtures/card-dark.png", import.meta.url));

/** Luminosidad L (0–100) de un hex, para aseverar "es oscuro / es claro". */
function lightnessOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255) * 100;
}

describe("extractBrandColors", () => {
  it("devuelve hex plausibles (no crudos ni vacios) para la cara de la tarjeta", async () => {
    const colors = await extractBrandColors(FIXTURE);
    expect(colors.primary).toBeDefined();
    expect(colors.primary!.hex).toMatch(HEX6);
    // textColor es siempre uno de los dos legibles (WCAG)
    expect(["#ffffff", "#000000"]).toContain(colors.primary!.textColor);
  });

  it("descarta el fondo blanco (ignoreWhite): ningun rol es blanco", async () => {
    const colors = await extractBrandColors(FIXTURE);
    const hexes = [colors.primary?.hex, colors.secondary?.hex, colors.accent?.hex].filter(
      Boolean,
    ) as string[];
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) {
      expect(hex.toLowerCase()).not.toBe("#ffffff");
      // y no un casi-blanco: la suma de canales de un blanco (~765) es alta
      const n = parseInt(hex.slice(1), 16);
      const sum = ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
      expect(sum).toBeLessThan(720);
    }
  });

  it("recupera los dos colores de marca del fixture (azul y naranja)", async () => {
    const colors = await extractBrandColors(FIXTURE);
    const hexes = new Set(
      [colors.primary?.hex, colors.secondary?.hex, colors.accent?.hex]
        .filter(Boolean)
        .map((h) => h!.toLowerCase()),
    );
    expect(hexes.has("#f97316")).toBe(true); // naranja
    expect(hexes.has("#1d4ed8")).toBe(true); // azul
  });

  it("es determinista: dos corridas dan lo mismo", async () => {
    const a = await extractBrandColors(FIXTURE);
    const b = await extractBrandColors(FIXTURE);
    expect(a).toEqual(b);
  });

  it("no repite un mismo hex en dos roles distintos", async () => {
    const colors = await extractBrandColors(FIXTURE);
    const hexes = [colors.primary?.hex, colors.secondary?.hex, colors.accent?.hex].filter(Boolean);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});

describe("extractBrandColors — tarjeta oscura (heuristica de peso de marca)", () => {
  // Regresion del caso Valentina: la heuristica vieja ("el mas saturado") mandaba
  // el gris claro a primary. Ahora el OSCURO dominante debe ser primary.
  it("elige el color OSCURO dominante como primary, no el gris claro", async () => {
    const colors = await extractBrandColors(DARK_FIXTURE);
    expect(colors.primary).toBeDefined();
    // primary oscuro (L bajo); el claro queda relegado a otro rol
    expect(lightnessOf(colors.primary!.hex)).toBeLessThan(40);
    expect(colors.primary!.textColor).toBe("#ffffff"); // texto blanco sobre oscuro
  });

  it("no manda el color de marca oscuro a secondary/accent", async () => {
    const colors = await extractBrandColors(DARK_FIXTURE);
    const light = [colors.secondary?.hex, colors.accent?.hex].filter(Boolean) as string[];
    // el/los otros roles son mas claros que el primary
    for (const hex of light) {
      expect(lightnessOf(hex)).toBeGreaterThan(lightnessOf(colors.primary!.hex));
    }
  });
});

describe("extractPalette", () => {
  it("devuelve una lista de hex plausibles (no vacia, sin blanco de fondo)", async () => {
    const palette = await extractPalette(FIXTURE);
    expect(palette.length).toBeGreaterThan(0);
    expect(palette.length).toBeLessThanOrEqual(8);
    for (const hex of palette) {
      expect(hex).toMatch(HEX6); // ya en minusculas
      expect(hex).not.toBe("#ffffff");
      const n = parseInt(hex.slice(1), 16);
      const sum = ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
      expect(sum).toBeLessThan(720); // ni casi-blanco
    }
  });

  it("incluye los colores de marca del fixture (azul y naranja)", async () => {
    const palette = new Set(await extractPalette(FIXTURE));
    expect(palette.has("#f97316")).toBe(true);
    expect(palette.has("#1d4ed8")).toBe(true);
  });

  it("no repite hex (deduplicada) y es determinista", async () => {
    const a = await extractPalette(FIXTURE);
    const b = await extractPalette(FIXTURE);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe("resolveAssignedColors — la baranda (LLM elige, no inventa)", () => {
  const PALETTE = ["#1d4ed8", "#f97316", "#111111"];

  it("acepta un rol cuyo hex ESTA en la paleta y le calcula el textColor", () => {
    const out = resolveAssignedColors({ primary: "#1d4ed8", accent: "#f97316" }, PALETTE);
    expect(out.primary).toEqual({ hex: "#1d4ed8", textColor: "#ffffff" }); // azul oscuro
    expect(out.accent).toEqual({ hex: "#f97316", textColor: expect.stringMatching(HEX6) });
  });

  it("DESCARTA un hex que el LLM invento fuera de la paleta", () => {
    const out = resolveAssignedColors({ primary: "#abcdef" }, PALETTE);
    expect(out.primary).toBeUndefined();
    expect(Object.keys(out)).toHaveLength(0);
  });

  it("empareja sin importar mayusculas ni el '#'", () => {
    const out = resolveAssignedColors({ primary: "1D4ED8" }, PALETTE);
    expect(out.primary?.hex).toBe("#1d4ed8");
  });

  it("ignora roles en null/undefined/vacio", () => {
    const out = resolveAssignedColors({ primary: null, secondary: undefined, accent: "" }, PALETTE);
    expect(Object.keys(out)).toHaveLength(0);
  });

  it("asigna el rol 'text' (tinta) si esta en la paleta", () => {
    const out = resolveAssignedColors({ text: "#111111" }, PALETTE);
    expect(out.text?.hex).toBe("#111111");
  });

  it("sin paleta no acepta ningun color (todo se cae a la heuristica arriba)", () => {
    const out = resolveAssignedColors({ primary: "#1d4ed8" }, []);
    expect(Object.keys(out)).toHaveLength(0);
  });
});

describe("textColorFor", () => {
  it("recomienda texto blanco sobre un color oscuro", () => {
    expect(textColorFor("#24376d")).toBe("#ffffff");
    expect(textColorFor("#000000")).toBe("#ffffff");
  });

  it("recomienda texto negro sobre un color claro", () => {
    expect(textColorFor("#e5e9ee")).toBe("#000000");
    expect(textColorFor("#ffffff")).toBe("#000000");
  });

  it("tolera hex sin '#' y devuelve undefined si no es hex de 6 digitos", () => {
    expect(textColorFor("24376d")).toBe("#ffffff");
    expect(textColorFor("azul")).toBeUndefined();
    expect(textColorFor("#fff")).toBeUndefined();
  });
});

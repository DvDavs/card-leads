import { describe, expect, it } from "vitest";
import { extractBalancedJson, parseJsonLoose } from "../../src/lib/llm/json-repair.js";

/**
 * Tests deterministas de json-repair: la defensa contra un fallo REAL en
 * produccion con gemini-3.1-flash-lite (droplet, 2026-07-11, lead "front"):
 * `responseMimeType: "application/json"` pero el modelo agrega un "}" de mas
 * despues del cierre real. finishReason era "STOP" (no "MAX_TOKENS"), el JSON
 * era completo y valido salvo por ese sobrante -- JSON.parse fallaba entero
 * por un solo caracter de basura al final.
 */

describe("extractBalancedJson", () => {
  it("un objeto simple ya balanceado se devuelve tal cual", () => {
    expect(extractBalancedJson('{"a":1}')).toBe('{"a":1}');
  });

  it("descarta un '}' extra al final (el fallo real observado)", () => {
    const withTrailingGarbage = '{"hero_headline":"x","demo":{"rating":{"value":"4.8"}}}\n}';
    expect(extractBalancedJson(withTrailingGarbage)).toBe(
      '{"hero_headline":"x","demo":{"rating":{"value":"4.8"}}}',
    );
  });

  it("ignora texto/ruido ANTES del primer '{'", () => {
    expect(extractBalancedJson('Aca esta el JSON:\n{"a":1}')).toBe('{"a":1}');
  });

  it("no se confunde con llaves dentro de un string", () => {
    const text = '{"note":"esto tiene { y } adentro de un string"}';
    expect(extractBalancedJson(text)).toBe(text);
  });

  it("respeta comillas escapadas dentro de strings", () => {
    const text = '{"note":"cita: \\"cerrada\\""}';
    expect(extractBalancedJson(text)).toBe(text);
  });

  it("un array top-level tambien balancea (no solo objetos)", () => {
    expect(extractBalancedJson("[1,2,3] basura")).toBe("[1,2,3]");
  });

  it("texto que nunca cierra (truncado de verdad) da null: nada que rescatar", () => {
    expect(extractBalancedJson('{"a":"corte a la mitad')).toBeNull();
  });

  it("sin ningun '{' ni '[' da null", () => {
    expect(extractBalancedJson("no hay json aca")).toBeNull();
  });
});

describe("parseJsonLoose", () => {
  it("JSON valido parsea normal (camino feliz, sin tocar el fallback)", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it("rescata el objeto real cuando sobra un '}' al final", () => {
    expect(parseJsonLoose('{"a":1,"b":{"c":2}}\n}')).toEqual({ a: 1, b: { c: 2 } });
  });

  it("reproduce el caso real: enrichment completo con un '}' de mas", () => {
    const raw =
      '{\n  "hero_headline": "x",\n  "demo": {\n    "rating": { "value": "4.8", "count_label": "128 reseñas" }\n  }\n}\n}';
    const parsed = parseJsonLoose(raw) as any;
    expect(parsed.hero_headline).toBe("x");
    expect(parsed.demo.rating.value).toBe("4.8");
  });

  it("si esta genuinamente truncado, lanza el error ORIGINAL de JSON.parse (no el del fallback)", () => {
    expect(() => parseJsonLoose('{"a":"corte a la mitad')).toThrow();
  });
});

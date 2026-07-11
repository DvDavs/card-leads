/**
 * json-repair.ts — defensa contra un fallo real observado con
 * gemini-3.1-flash-lite: pese a `responseMimeType: "application/json"`, el
 * modelo a veces devuelve el objeto JSON completo y valido pero con basura
 * extra DESPUES del cierre (ej. un "}" de mas). `JSON.parse` sobre el texto
 * completo falla por ese sobrante aunque el contenido real este intacto.
 *
 * `extractBalancedJson` busca el primer objeto/array balanceado (desde el
 * primer `{`/`[` hasta su cierre correspondiente, respetando strings y
 * escapes) e ignora todo lo que sobre despues. Si el texto nunca cierra
 * (truncado de verdad, ej. corte real por limite de tokens) devuelve null: no
 * hay nada rescatable.
 */
export function extractBalancedJson(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const open = text[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // nunca balanceo: no hay un objeto/array completo que rescatar
}

/**
 * parseJsonLoose — JSON.parse normal; si falla, reintenta solo con el primer
 * objeto/array balanceado del texto (descarta basura sobrante). Lanza el
 * error ORIGINAL (no el del reintento) si ninguno de los dos parsea, para que
 * el mensaje de error siga apuntando al texto real del modelo.
 */
export function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (original) {
    const balanced = extractBalancedJson(text);
    if (balanced !== null) {
      try {
        return JSON.parse(balanced);
      } catch {
        // el substring balanceado tampoco parsea: cae al throw de abajo
      }
    }
    throw original;
  }
}

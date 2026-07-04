import { createColor, getPalette, getSwatches } from "colorthief";
import type { Color, SwatchMap, SwatchRole } from "colorthief";

/**
 * colors.ts — extraccion de colores de marca por MEDICION de pixeles, no por
 * adivinanza de un LLM. El modelo de vision estimaba los colores fatal (decia
 * "negro" a un verde, "marron" a un azul) porque el color no es una tarea de
 * lenguaje: es leer los pixeles reales de la imagen. Eso hace colorthief.
 */

/** Un color de marca ya medido: hex + el color de texto legible encima (WCAG). */
export interface BrandColor {
  hex: string; // "#rrggbb"
  textColor: string; // "#ffffff" | "#000000" — el legible sobre `hex`
}

/** Los tres roles de marca que consume el resto del pipeline. */
export interface ExtractedBrandColors {
  primary?: BrandColor;
  secondary?: BrandColor;
  accent?: BrandColor;
}

/** Roles semanticos de colorthief que consideramos candidatos de marca. */
const ROLES: SwatchRole[] = [
  "DarkVibrant",
  "Vibrant",
  "DarkMuted",
  "Muted",
  "LightVibrant",
  "LightMuted",
];

// ─────────────────────────── Umbrales de la heuristica (TUNEABLES) ───────────────────────────
// Todos H/S/L en 0–100 (escala de colorthief). Ver `brandWeight` para el porque.

/** L >= este valor => casi-blanco/gris muy claro: casi excluido de primary (×0.15). */
const LIGHT_HARD_L = 80;
/** L >= este valor => color claro: se demota a la mitad (×0.5). Papel/fondo suele caer aca. */
const LIGHT_SOFT_L = 62;
/** La oscuridad puntua desde L=60 hacia abajo (L<60 empieza a sumar; L=0 = maximo). */
const DARK_REF_L = 60;
/** Area (proporcion 0–1) que ya cuenta como "presencia grande": satura el termino ahi. */
const AREA_REF = 0.3;
/** Distancia RGB minima entre los tres roles: evita 3 tonos casi iguales (caso Valentina). */
const MIN_ROLE_DIST = 45;

// Pesos del score de "peso de marca". Calibrados contra tarjetas reales:
//   Valentina (verde pino desaturado) → primary = el oscuro dominante #393b37
//   Karey (navy)                       → primary = #24376d (navy) / #352122 (vino)
//   Vania (indigo)                     → primary = #484c6f (indigo)
/** Peso de la SATURACION: sube el croma de marca por encima de los casi-grises. */
const W_SAT = 1.2;
/** Peso del AREA: premia estar presente en la tarjeta (no un pixel suelto). */
const W_AREA = 0.6;
/** Peso de la OSCURIDAD: la marca suele ser el color oscuro dominante. */
const W_DARK = 1.0;

function toBrandColor(c: Color): BrandColor {
  return { hex: c.hex(), textColor: c.textColor };
}

/** Componentes RGB 0–255 de un hex "#rrggbb". */
function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Distancia euclidiana en RGB (0–441). Simple y suficiente para "¿son distintos?". */
function rgbDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/**
 * mergeSwatches — combina los swatches de varias caras en un solo mapa.
 * El color de marca puede vivir en el reverso (p.ej. logo detras), asi que se
 * corren ambas caras y, cuando un mismo rol aparece en las dos, se queda con el
 * de MAYOR poblacion (mas pixeles = mas presente en la tarjeta).
 */
function mergeSwatches(maps: SwatchMap[]): SwatchMap {
  const out = {} as SwatchMap;
  for (const role of ROLES) {
    let best: SwatchMap[SwatchRole] = null;
    for (const m of maps) {
      const s = m[role];
      if (s && (!best || s.color.population > best.color.population)) best = s;
    }
    out[role] = best;
  }
  return out;
}

/**
 * brandWeight — cuanto "pesa" un color como color de MARCA (mas alto = mas marca).
 *
 * El problema que resuelve: en tarjetas oscuras la version vieja (elegir el mas
 * saturado) mandaba un gris claro a primary y el verde de marca a secondary. El
 * color de marca casi siempre es el OSCURO DOMINANTE, no el claro. Entonces:
 *   score = W_SAT*saturacion + W_AREA*area + W_DARK*oscuridad
 * y ademas se PENALIZA la luminosidad alta (papel/fondo claro):
 *   - L >= LIGHT_HARD_L (muy claro)  => ×0.15  (casi nunca primary)
 *   - L >= LIGHT_SOFT_L (claro)      => ×0.5
 *
 * Nota sobre "casi-grises": no los penalizamos con un termino aparte. La
 * saturacion entra como POSITIVO (W_SAT), asi que un casi-gris queda demotado
 * frente a un color saturado *por si solo*. Pero la oscuridad (W_DARK) y el area
 * (W_AREA) todavia pueden llevar a primary a un color OSCURO y desaturado cuando
 * no hay nada mejor — que es justo el verde pino desaturado de Valentina (S≈4).
 * Eso cumple el requisito "muy baja saturacion no deberia ser primary SALVO que
 * no haya nada mejor": si toda la tarjeta es desaturada, gana el oscuro dominante.
 */
function brandWeight(c: Color): number {
  const { s: S, l: L } = c.hsl(); // 0–100
  const s = S / 100;
  const a = Math.min((c.proportion ?? 0) / AREA_REF, 1);
  const dark = Math.max(0, (DARK_REF_L - L) / DARK_REF_L);
  let score = W_SAT * s + W_AREA * a + W_DARK * dark;
  if (L >= LIGHT_HARD_L) score *= 0.15;
  else if (L >= LIGHT_SOFT_L) score *= 0.5;
  return score;
}

/**
 * extractBrandColors — mide los colores de marca de la(s) foto(s) de la tarjeta.
 *
 * FLUJO:
 * 1. Corre colorthief con `ignoreWhite: true` para descartar el fondo blanco.
 * 2. Candidatos = swatches semanticos combinados de ambas caras. Se usan los
 *    swatches (no la paleta cruda) porque la paleta incluye el PAPEL/fondo como
 *    areas enormes de colores claros; los swatches ya separan el fondo en su
 *    propio rol claro (LightMuted). Si la imagen esta tan lavada que no hay
 *    ningun swatch, cae a la paleta cruda como respaldo.
 * 3. primary = el candidato con mayor `brandWeight` (oscuro/saturado/presente,
 *    ver esa funcion). secondary y accent = los siguientes de mayor peso que sean
 *    lo bastante DISTINTOS (>= MIN_ROLE_DIST en RGB) de los ya elegidos, para no
 *    devolver tres tonos casi iguales. Si no quedan colores distintos, el rol
 *    sobrante queda vacio (undefined) en vez de repetir uno.
 *
 * LANZA si colorthief/sharp no pueden leer la imagen. El caller (extract) decide
 * el fallback: no crashea, deja vacios los colores y lo anota como pendiente para
 * revisar en verify.
 */
export async function extractBrandColors(
  frontPath: string,
  backPath?: string,
): Promise<ExtractedBrandColors> {
  const paths = [frontPath, ...(backPath ? [backPath] : [])];

  // ignoreWhite descarta el fondo blanco de la tarjeta (es el default, explicito
  // aca para dejar clara la intencion).
  const swatchMaps = await Promise.all(paths.map((p) => getSwatches(p, { ignoreWhite: true })));
  const paletteLists = await Promise.all(paths.map((p) => getPalette(p, { ignoreWhite: true })));

  const merged = mergeSwatches(swatchMaps);
  let candidates: Color[] = ROLES.map((r) => merged[r]?.color).filter((c): c is Color => !!c);

  // Respaldo: si no hay NINGUN swatch (imagen muy lavada), usa la paleta cruda
  // (dedup por hex). Es peor (incluye fondo), pero mejor que no devolver nada.
  if (candidates.length === 0) {
    const byHex = new Map<string, Color>();
    for (const list of paletteLists) for (const c of list ?? []) byHex.set(c.hex().toLowerCase(), c);
    candidates = [...byHex.values()];
  }

  // Ordena por peso de marca y elige greedy garantizando contraste entre roles.
  const ranked = candidates.sort((x, y) => brandWeight(y) - brandWeight(x));
  const chosen: Color[] = [];
  for (const c of ranked) {
    if (chosen.every((p) => rgbDistance(p.hex(), c.hex()) >= MIN_ROLE_DIST)) chosen.push(c);
    if (chosen.length === 3) break;
  }
  const [primary, secondary, accent] = chosen;

  return {
    ...(primary ? { primary: toBrandColor(primary) } : {}),
    ...(secondary ? { secondary: toBrandColor(secondary) } : {}),
    ...(accent ? { accent: toBrandColor(accent) } : {}),
  };
}

/** Parsea "#rrggbb" o "rrggbb" a componentes 0–255, o null si no es hex de 6. */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * textColorFor — dado un hex, devuelve el color de texto legible encima
 * ("#ffffff" o "#000000") usando el mismo calculo WCAG de colorthief. Se usa en
 * verify para RECALCULAR el textColor cuando el humano corrige un hex a mano, y
 * asi el textColor guardado nunca queda desfasado del color. undefined si el hex
 * no es valido.
 */
export function textColorFor(hex: string): string | undefined {
  const rgb = parseHex(hex);
  if (!rgb) return undefined;
  return createColor(rgb.r, rgb.g, rgb.b, 1).textColor;
}

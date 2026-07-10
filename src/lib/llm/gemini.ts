import { promises as fs } from "node:fs";
import path from "node:path";
import type { VisionProvider } from "./index.js";
import { parseExtraction, type ExtractionResult } from "./extraction.js";
import { parseEnrichment, type EnrichInput, type EnrichmentResult } from "./enrichment.js";
import { loadEnrichPrompt, loadExtractPrompt } from "./prompt.js";

/**
 * gemini.ts — proveedor LLM con la REST API de Google Generative Language.
 * Sin SDK: usa fetch global (Node >= 18) para no sumar dependencias en etapas
 * que corren una vez por tarjeta. El modelo default es el "flash" barato.
 *
 * Dos capacidades comparten el mismo plumbing HTTP (`generateText`):
 *  - extractCard: manda las fotos + la paleta (vision) -> ExtractionResult.
 *  - enrichCopy:  manda solo texto (datos verificados) -> EnrichmentResult.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

interface InlineDataPart {
  inline_data: { mime_type: string; data: string };
}

type Part = { text: string } | InlineDataPart;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

/** Salida cruda del modelo o un fallo YA en la forma comun de *Result. */
type GenTextResult =
  | { ok: true; text: string }
  | { ok: false; error: string; raw: string };

function mimeOf(p: string): string {
  switch (path.extname(p).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

async function imagePart(p: string): Promise<InlineDataPart> {
  const buf = await fs.readFile(p);
  return { inline_data: { mime_type: mimeOf(p), data: buf.toString("base64") } };
}

/**
 * withPalette — anexa al prompt de extraccion el bloque de asignacion de color.
 * Le da al modelo la paleta MEDIDA y le pide asignar cada rol eligiendo un hex
 * EXACTO de esa lista. Si la paleta viene vacia (colorthief no midio nada), no
 * anexa nada: el modelo no asigna colores y el caller usa la heuristica.
 */
function withPalette(prompt: string, palette?: string[]): string {
  if (!palette || palette.length === 0) return prompt;
  return (
    prompt +
    `\n\n## Paleta de colores medida\n` +
    `Estos son los colores REALES de la tarjeta, medidos de los pixeles:\n` +
    `${palette.join(", ")}\n` +
    `Llena el objeto "colors" asignando a cada rol UN hex EXACTO de esta lista ` +
    `(copialo tal cual, en minusculas). Usa la imagen para decidir cual va en cada rol. ` +
    `PROHIBIDO devolver un hex que no este en la lista. Si un rol no tiene buen ` +
    `candidato en la lista, ponlo en null.`
  );
}

/**
 * withBusinessData — anexa al prompt de enriquecimiento los datos VERIFICADOS
 * del lead. El modelo redacta el copy A PARTIR de esto; nunca inventa contacto.
 */
function withBusinessData(prompt: string, input: EnrichInput): string {
  const lines = [
    `- rubro: ${input.rubro}`,
    `- nombre del negocio: ${input.businessName || "(sin nombre)"}`,
  ];
  if (input.personName) lines.push(`- persona / profesional: ${input.personName}`);
  if (input.tagline) lines.push(`- lema / tagline: ${input.tagline}`);
  if (input.location) lines.push(`- ubicacion: ${input.location}`);
  lines.push(
    `- servicios REALES (usalos textuales en service_descriptions, uno por servicio): ${
      input.services.length ? input.services.join(", ") : "(ninguno listado)"
    }`,
  );
  return prompt + `\n\n## Datos del negocio (verificados)\n` + lines.join("\n") + "\n";
}

/** Lee una env var numerica; devuelve undefined si falta o no es numero. */
function numEnv(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * buildGenerationConfig — la config comun a ambas llamadas: fuerza JSON puro
 * (responseMimeType) y permite overridear temperature/tokens/topP/topK por env.
 * `thinkingBudget: 0` porque los gemini-2.5-* gastan tokens de salida "pensando"
 * antes de escribir y eso corta el JSON a la mitad con un maxOutputTokens chico;
 * ni extraccion ni copy necesitan razonar. Overridable por env.
 */
function buildGenerationConfig(): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = { responseMimeType: "application/json" };
  const temperature = numEnv("GEMINI_TEMPERATURE");
  const maxOutputTokens = numEnv("GEMINI_MAX_TOKENS");
  const topP = numEnv("GEMINI_TOP_P");
  const topK = numEnv("GEMINI_TOP_K");
  if (temperature !== undefined) generationConfig.temperature = temperature;
  if (maxOutputTokens !== undefined) generationConfig.maxOutputTokens = maxOutputTokens;
  if (topP !== undefined) generationConfig.topP = topP;
  if (topK !== undefined) generationConfig.topK = topK;
  generationConfig.thinkingConfig = { thinkingBudget: numEnv("GEMINI_THINKING_BUDGET") ?? 0 };
  return generationConfig;
}

/** Llave o error temprano y claro (no reventar recien al pegarle al modelo). */
function requireApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("llm/gemini: falta GEMINI_API_KEY en el entorno (.env)");
  return apiKey;
}

/**
 * generateText — el UNICO lugar que pega al REST API. Devuelve el texto crudo
 * del modelo, o un fallo YA en la forma comun de *Result (ok:false/error/raw)
 * para los casos "sin texto" y "MAX_TOKENS", que el caller propaga tal cual. Un
 * HTTP no-2xx si LANZA (es un fallo de infraestructura, no de contenido).
 */
async function generateText(parts: Part[]): Promise<GenTextResult> {
  const apiKey = requireApiKey();
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: buildGenerationConfig() }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`llm/gemini: HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`);
  }

  const body = (await res.json()) as GeminiResponse;
  const finishReason = body.candidates?.[0]?.finishReason;
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  if (!text.trim()) {
    // sin texto: bloqueo por seguridad o corte por tokens. No lanza: es un fallo
    // de contenido, va a meta.errors como cualquier respuesta invalida.
    const reason = finishReason ?? body.promptFeedback?.blockReason ?? "sin texto";
    return { ok: false, error: `gemini no devolvio texto (${reason})`, raw: JSON.stringify(body).slice(0, 300) };
  }

  // Con texto PERO cortado por limite de tokens: el JSON queda incompleto y
  // parsear daria el error generico "no es JSON valido". Damos uno accionable.
  if (finishReason === "MAX_TOKENS") {
    return {
      ok: false,
      error:
        "gemini corto la respuesta por limite de tokens (MAX_TOKENS): el JSON quedo incompleto. " +
        "Subi GEMINI_MAX_TOKENS (p.ej. 4096) y/o deja GEMINI_THINKING_BUDGET=0 en tu .env.",
      raw: text.slice(0, 300),
    };
  }

  return { ok: true, text };
}

export function geminiProvider(): VisionProvider {
  return {
    name: "gemini",
    async extractCard(front: string, back?: string, palette?: string[]): Promise<ExtractionResult> {
      // La paleta MEDIDA (colorthief) se anexa al prompt para que el modelo asigne
      // roles de color eligiendo hex de esa lista (nunca inventa uno).
      const prompt = withPalette(await loadExtractPrompt(), palette);
      const parts: Part[] = [{ text: prompt }, await imagePart(front)];
      if (back) parts.push(await imagePart(back));

      const r = await generateText(parts);
      if (!r.ok) return r;
      return parseExtraction(r.text);
    },
    async enrichCopy(input: EnrichInput): Promise<EnrichmentResult> {
      const prompt = withBusinessData(await loadEnrichPrompt(), input);
      const r = await generateText([{ text: prompt }]);
      if (!r.ok) return r;
      return parseEnrichment(r.text);
    },
  };
}

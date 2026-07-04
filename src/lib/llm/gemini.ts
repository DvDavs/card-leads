import { promises as fs } from "node:fs";
import path from "node:path";
import type { VisionProvider } from "./index.js";
import { parseExtraction, type ExtractionResult } from "./extraction.js";
import { loadExtractPrompt } from "./prompt.js";

/**
 * gemini.ts — proveedor de vision con la REST API de Google Generative Language.
 * Sin SDK: usa fetch global (Node >= 18) para no sumar dependencias en una etapa
 * que corre una vez por tarjeta. El modelo default es el "flash" barato.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

interface InlineDataPart {
  inline_data: { mime_type: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

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

/** Lee una env var numerica; devuelve undefined si falta o no es numero. */
function numEnv(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function geminiProvider(): VisionProvider {
  return {
    name: "gemini",
    async extractCard(front: string, back?: string): Promise<ExtractionResult> {
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error("llm/gemini: falta GEMINI_API_KEY en el entorno (.env)");
      }

      const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
      const prompt = await loadExtractPrompt();

      const parts: Array<{ text: string } | InlineDataPart> = [
        { text: prompt },
        await imagePart(front),
      ];
      if (back) parts.push(await imagePart(back));

      // responseMimeType fuerza JSON puro (sin markdown), lo que pide el prompt.
      const generationConfig: Record<string, unknown> = { responseMimeType: "application/json" };
      const temperature = numEnv("GEMINI_TEMPERATURE");
      const maxOutputTokens = numEnv("GEMINI_MAX_TOKENS");
      const topP = numEnv("GEMINI_TOP_P");
      const topK = numEnv("GEMINI_TOP_K");
      if (temperature !== undefined) generationConfig.temperature = temperature;
      if (maxOutputTokens !== undefined) generationConfig.maxOutputTokens = maxOutputTokens;
      if (topP !== undefined) generationConfig.topP = topP;
      if (topK !== undefined) generationConfig.topK = topK;

      const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }], generationConfig }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `llm/gemini: HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`,
        );
      }

      const body = (await res.json()) as GeminiResponse;
      const text =
        body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

      if (!text.trim()) {
        // sin texto: bloqueo por seguridad o corte por tokens. No lanza: es un
        // fallo de extraccion, va a meta.errors como cualquier respuesta invalida.
        const reason =
          body.candidates?.[0]?.finishReason ?? body.promptFeedback?.blockReason ?? "sin texto";
        return {
          ok: false,
          error: `gemini no devolvio texto (${reason})`,
          raw: JSON.stringify(body).slice(0, 300),
        };
      }

      return parseExtraction(text);
    },
  };
}

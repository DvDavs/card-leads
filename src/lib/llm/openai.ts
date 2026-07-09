import type { VisionProvider } from "./index.js";
import type { ExtractionResult } from "./extraction.js";

/**
 * openai — STUB deliberado. La interfaz ya esta lista para cuando se implemente;
 * arrancamos solo con Gemini. Cuando toque: modelo gpt-4o-mini (el barato con
 * vision), imagenes como data URL en el content del mensaje, y la respuesta se
 * valida con el MISMO parseExtraction que Gemini para devolver la misma forma.
 */
export function openaiProvider(): VisionProvider {
  return {
    name: "openai",
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async extractCard(_front: string, _back?: string, _palette?: string[]): Promise<ExtractionResult> {
      throw new Error(
        "llm/openai: no implementado todavia. Usa LLM_PROVIDER=gemini " +
          "(gpt-4o-mini queda para una siguiente iteracion).",
      );
    },
  };
}

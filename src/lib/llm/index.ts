/**
 * llm/index.ts — interfaz de proveedor + switch. Aun SIN implementar el LLM.
 * La etapa `extract` usara esto para llamar vision -> JSON.
 */

export interface VisionRequest {
  prompt: string;
  images: string[]; // rutas locales o base64
}

export interface LlmProvider {
  name: string;
  /** Devuelve texto crudo (se espera JSON) a partir de imagenes + prompt. */
  vision(req: VisionRequest): Promise<string>;
}

export type ProviderName = "openai" | "gemini";

export async function getProvider(name: ProviderName): Promise<LlmProvider> {
  switch (name) {
    case "openai": {
      const { openaiProvider } = await import("./openai.js");
      return openaiProvider();
    }
    case "gemini": {
      const { geminiProvider } = await import("./gemini.js");
      return geminiProvider();
    }
    default:
      throw new Error(`llm: proveedor desconocido "${name as string}"`);
  }
}

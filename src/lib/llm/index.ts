import type { ExtractionResult } from "./extraction.js";

/**
 * llm/index.ts — la interfaz comun de vision + el switch por proveedor.
 *
 * Cambiar de proveedor = cambiar la env var LLM_PROVIDER, nada mas. Todos los
 * proveedores implementan la MISMA interfaz y devuelven la MISMA forma
 * (ExtractionResult), validada por el MISMO schema (parseExtraction). El caller
 * (la etapa `extract`) no sabe ni le importa que modelo respondio.
 */

export interface VisionProvider {
  name: string;
  /**
   * Lee la(s) foto(s) de la tarjeta y devuelve la extraccion YA validada.
   * @param front ruta absoluta a la foto del frente (requerida)
   * @param back  ruta absoluta a la foto del reverso (opcional)
   */
  extractCard(front: string, back?: string): Promise<ExtractionResult>;
}

export type ProviderName = "openai" | "gemini";

const PROVIDERS: readonly ProviderName[] = ["openai", "gemini"];

/**
 * Resuelve el proveedor desde LLM_PROVIDER. Default "gemini" (arrancamos solo
 * con Gemini). Valida el valor para fallar temprano con un mensaje claro en vez
 * de reventar recien al llamar al modelo.
 */
export function resolveProviderName(env: NodeJS.ProcessEnv = process.env): ProviderName {
  const raw = (env.LLM_PROVIDER ?? "gemini").trim().toLowerCase();
  if (!PROVIDERS.includes(raw as ProviderName)) {
    throw new Error(`LLM_PROVIDER invalido "${raw}". Validos: ${PROVIDERS.join(", ")}`);
  }
  return raw as ProviderName;
}

export async function getProvider(name: ProviderName): Promise<VisionProvider> {
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

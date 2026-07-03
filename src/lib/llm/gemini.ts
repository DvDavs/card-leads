import type { LlmProvider } from "./index.js";

/** gemini — STUB. Aun no implementado. */
export function geminiProvider(): LlmProvider {
  return {
    name: "gemini",
    async vision() {
      throw new Error("llm/gemini: no implementado");
    },
  };
}

import type { LlmProvider } from "./index.js";

/** openai — STUB. Aun no implementado. */
export function openaiProvider(): LlmProvider {
  return {
    name: "openai",
    async vision() {
      throw new Error("llm/openai: no implementado");
    },
  };
}

import { configDefaults, defineConfig } from "vitest/config";

/**
 * Los worktrees de agentes viven en `.claude/worktrees/` y son copias
 * completas del repo (tests incluidos). Sin este exclude, `vitest` corrido
 * desde la raiz recolecta cada copia y ejecuta la suite N veces (ademas de
 * fallar contra worktrees a mitad de un cambio). Solo cuentan los tests del
 * arbol raiz (`tests/`).
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});

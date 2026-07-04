/**
 * env.ts — carga el archivo .env del cwd hacia process.env una sola vez.
 * Usa el loader nativo de Node (process.loadEnvFile, Node >= 20.12). Si no hay
 * .env (o el runtime no soporta el loader) sigue con lo que ya haya en el
 * entorno, para no obligar a tener .env en CI o cuando las vars vienen del shell.
 */
let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  try {
    process.loadEnvFile();
  } catch {
    // sin .env o loader no disponible: se usan las vars del shell si existen
  }
}

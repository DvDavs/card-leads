import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

/**
 * ssh.ts — unico modulo que toca node:child_process. Todo lo que habla con
 * el droplet (deploy) pasa por `runCommand`, asi queda mockeable en tests sin
 * spawnear procesos reales.
 *
 * `execFile` (no `exec`) corre el binario directo, sin shell local: en
 * Windows eso evita el quoting hell de cmd.exe/PowerShell con rutas y
 * argumentos remotos que ya traen sus propias comillas.
 */

export interface RunCommandOptions {
  cwd?: string;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
}

/** Corre `cmd args...` y devuelve stdout/stderr. Lanza con mensaje en espanol si falla. */
export async function runCommand(
  cmd: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: options.cwd,
      windowsHide: true,
    });
    return { stdout, stderr };
  } catch (err) {
    throw new Error(describeError(cmd, err));
  }
}

function describeError(cmd: string, err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
  if (e.code === "ENOENT") {
    return `no se encontro "${cmd}" en el PATH.`;
  }
  const detail = (e.stderr || e.stdout || e.message || String(err)).trim();
  return `${cmd} fallo: ${detail}`;
}

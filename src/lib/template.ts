/**
 * template.ts — motor de templates {{variables}} minimalista, puro y determinista.
 *
 * Subconjunto tipo mustache, suficiente para el linktree:
 *   {{clave}}          interpolacion escapada (HTML-safe)
 *   {{objeto.prop}}    acceso por punto
 *   {{{clave}}} / {{&clave}}   interpolacion cruda (sin escapar)
 *   {{#clave}}...{{/clave}}    seccion: si array -> repite; si truthy -> una vez
 *   {{^clave}}...{{/clave}}    seccion invertida: renderiza si falsy/array vacio
 *   {{.}}              el item actual (dentro de una seccion sobre array de strings)
 *
 * Sin dependencias. Se parsea a un AST y luego se renderiza con una pila de
 * contextos, para que el anidamiento y la resolucion de nombres sean predecibles.
 */

type Node =
  | { t: "text"; v: string }
  | { t: "var"; name: string; raw: boolean }
  | { t: "section"; name: string; inverted: boolean; children: Node[] };

const TOKEN =
  /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([#^/&]?)\s*([\w.]+)\s*\}\}/g;

function parse(tpl: string): Node[] {
  const root: Node[] = [];
  const stack: { name: string; children: Node[] }[] = [];
  const top = (): Node[] =>
    stack.length ? stack[stack.length - 1]!.children : root;

  let last = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = TOKEN.exec(tpl)) !== null) {
    if (m.index > last) top().push({ t: "text", v: tpl.slice(last, m.index) });
    last = TOKEN.lastIndex;

    const rawName = m[1];
    if (rawName !== undefined) {
      top().push({ t: "var", name: rawName, raw: true });
      continue;
    }

    const sigil = m[2] ?? "";
    const name = m[3]!;

    if (sigil === "#" || sigil === "^") {
      const section: Node = {
        t: "section",
        name,
        inverted: sigil === "^",
        children: [],
      };
      top().push(section);
      stack.push({ name, children: section.children });
    } else if (sigil === "/") {
      const open = stack.pop();
      if (!open || open.name !== name) {
        throw new Error(`Template: seccion mal cerrada "{{/${name}}}"`);
      }
    } else if (sigil === "&") {
      top().push({ t: "var", name, raw: true });
    } else {
      top().push({ t: "var", name, raw: false });
    }
  }

  if (last < tpl.length) top().push({ t: "text", v: tpl.slice(last) });
  if (stack.length) {
    throw new Error(`Template: seccion sin cerrar "{{#${stack[0]!.name}}}"`);
  }
  return root;
}

/** Resuelve `a.b.c` recorriendo la pila de contextos de adentro hacia afuera. */
function lookup(name: string, stack: unknown[]): unknown {
  if (name === ".") return stack[stack.length - 1];
  const parts = name.split(".");
  const head = parts[0]!;

  for (let i = stack.length - 1; i >= 0; i--) {
    const ctx = stack[i];
    if (ctx === null || typeof ctx !== "object") continue;
    if (!(head in (ctx as Record<string, unknown>))) continue;

    let val: unknown = ctx;
    for (const p of parts) {
      if (val === null || typeof val !== "object") return undefined;
      val = (val as Record<string, unknown>)[p];
    }
    return val;
  }
  return undefined;
}

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESCAPE[ch]!);
}

function isTruthy(val: unknown): boolean {
  return Array.isArray(val) ? val.length > 0 : Boolean(val);
}

function render(nodes: Node[], stack: unknown[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") {
      out += n.v;
    } else if (n.t === "var") {
      const val = lookup(n.name, stack);
      const s = val === null || val === undefined ? "" : String(val);
      out += n.raw ? s : escapeHtml(s);
    } else {
      const val = lookup(n.name, stack);
      if (n.inverted) {
        if (!isTruthy(val)) out += render(n.children, stack);
      } else if (Array.isArray(val)) {
        for (const item of val) out += render(n.children, [...stack, item]);
      } else if (isTruthy(val)) {
        out += render(n.children, [...stack, val]);
      }
    }
  }
  return out;
}

/** Rellena `template` con `view`. Puro: mismas entradas -> misma salida. */
export function renderTemplate(
  template: string,
  view: Record<string, unknown>,
): string {
  return render(parse(template), [view]);
}

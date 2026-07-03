import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { linktreeTemplate } from "../config/rubro-map.js";
import type { Lead } from "../lib/schema.js";
import { renderTemplate } from "../lib/template.js";
import { readLead, writeArtifact, writeLead } from "../lib/storage.js";

export interface LinktreeLink {
  label: string;
  url: string;
  kind: string;
}

/** Nombre del archivo de salida dentro de la carpeta del lead. */
export const LINKTREE_FILE = "linktree.html";

/** Solo digitos: WhatsApp necesita el numero pelado para wa.me. */
function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * buildLinktreeView — funcion PURA: Lead -> objeto de template.
 * Aca se arma la lista de links a partir de contact + socials, con fallbacks
 * sensatos. Separada del render para poder testearla de forma determinista.
 */
export function buildLinktreeView(lead: Lead): Record<string, unknown> {
  const c = lead.contact;
  const s = lead.socials;
  const links: LinktreeLink[] = [];

  if (c.whatsapp) links.push({ label: "WhatsApp", url: `https://wa.me/${digits(c.whatsapp)}`, kind: "whatsapp" });
  if (c.phone) links.push({ label: "Llamar", url: `tel:${c.phone}`, kind: "phone" });
  if (c.email) links.push({ label: "Email", url: `mailto:${c.email}`, kind: "email" });
  if (c.website) links.push({ label: "Sitio web", url: c.website, kind: "website" });
  if (s.instagram) links.push({ label: "Instagram", url: s.instagram, kind: "instagram" });
  if (s.facebook) links.push({ label: "Facebook", url: s.facebook, kind: "facebook" });
  if (s.tiktok) links.push({ label: "TikTok", url: s.tiktok, kind: "tiktok" });

  return {
    name: lead.business.name || lead.slug, // fallback al slug si aun no hay nombre
    tagline: lead.business.tagline ?? "",
    about: lead.content.about ?? "",
    services: lead.content.services,
    hasServices: lead.content.services.length > 0,
    links,
    hasLinks: links.length > 0,
    colors: {
      primary: lead.brand.colors.primary ?? "#111827",
      secondary: lead.brand.colors.secondary ?? "#374151",
      accent: lead.brand.colors.accent ?? "#2563eb",
    },
  };
}

async function loadTemplate(name: string): Promise<string> {
  // resuelto contra este archivo fuente, no contra el cwd
  const url = new URL(`../templates/${name}/index.html`, import.meta.url);
  return fs.readFile(fileURLToPath(url), "utf8");
}

/**
 * build-linktree — segunda etapa de la rebanada vertical.
 * Lee data.json, rellena el template generico y escribe linktree.html en la
 * carpeta del lead. Deja el status en "linktree_built".
 */
export async function buildLinktree(slug: string): Promise<string> {
  if (!slug) throw new Error("build-linktree: falta el slug. Uso: build-linktree <slug>");

  const lead = await readLead(slug);
  const template = await loadTemplate(linktreeTemplate());
  const html = renderTemplate(template, buildLinktreeView(lead));

  const outPath = await writeArtifact(slug, LINKTREE_FILE, html);

  await writeLead({
    ...lead,
    status: "linktree_built",
    generated: { ...lead.generated, linktree_url: LINKTREE_FILE },
  });

  return outPath;
}

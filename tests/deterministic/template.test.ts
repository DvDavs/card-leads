import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderTemplate } from "../../src/lib/template.js";
import { buildCardView } from "../../src/stages/build-cards.js";
import type { Lead } from "../../src/lib/schema.js";

describe("renderTemplate — basico", () => {
  it("interpola claves simples", () => {
    expect(renderTemplate("Hola {{name}}", { name: "Ana" })).toBe("Hola Ana");
  });

  it("resuelve rutas con punto", () => {
    expect(renderTemplate("{{a.b.c}}", { a: { b: { c: "x" } } })).toBe("x");
  });

  it("escapa HTML por defecto", () => {
    expect(renderTemplate("{{v}}", { v: '<b>&"' })).toBe("&lt;b&gt;&amp;&quot;");
  });

  it("no escapa con triple llave", () => {
    expect(renderTemplate("{{{v}}}", { v: "<b>" })).toBe("<b>");
  });

  it("variable faltante -> cadena vacia", () => {
    expect(renderTemplate("[{{nope}}]", {})).toBe("[]");
  });

  it("seccion sobre array repite y expone {{.}}", () => {
    expect(renderTemplate("{{#xs}}<{{.}}>{{/xs}}", { xs: ["a", "b"] })).toBe("<a><b>");
  });

  it("seccion sobre array de objetos expone props", () => {
    const out = renderTemplate("{{#ls}}[{{k}}]{{/ls}}", { ls: [{ k: "1" }, { k: "2" }] });
    expect(out).toBe("[1][2]");
  });

  it("seccion truthy renderiza una vez, falsy se omite", () => {
    expect(renderTemplate("{{#on}}si{{/on}}", { on: true })).toBe("si");
    expect(renderTemplate("{{#on}}si{{/on}}", { on: false })).toBe("");
    expect(renderTemplate("{{#xs}}si{{/xs}}", { xs: [] })).toBe("");
  });

  it("seccion invertida renderiza cuando falsy o array vacio", () => {
    expect(renderTemplate("{{^xs}}vacio{{/xs}}", { xs: [] })).toBe("vacio");
    expect(renderTemplate("{{^xs}}vacio{{/xs}}", { xs: [1] })).toBe("");
  });

  it("es determinista", () => {
    const tpl = "{{a}}-{{#xs}}{{.}}{{/xs}}";
    const view = { a: "z", xs: ["1", "2"] };
    expect(renderTemplate(tpl, view)).toBe(renderTemplate(tpl, view));
  });

  it("lanza si una seccion queda sin cerrar", () => {
    expect(() => renderTemplate("{{#x}}sin fin", {})).toThrow();
  });
});

/** Lead minimo valido para probar el render del linktree real. */
function sampleLead(): Lead {
  return {
    slug: "dr-perez-cardiologo",
    status: "linktree_built",
    rubro: "doctor",
    source: {
      card_front: "card_front.jpg",
      ingested_at: "2026-07-03T00:00:00.000Z",
      channel: "manual",
    },
    business: { name: "Dr. Pérez", tagline: "Cardiología", attrs: {} },
    contact: { whatsapp: "+52 55 1234 5678", email: "dr@perez.mx" },
    socials: { instagram: "https://instagram.com/drperez" },
    brand: { colors: { primary: "#0a1f44" }, has_logo: false },
    content: { services: ["Consulta", "Electrocardiograma"], about: "Atención cardiológica." },
    generated: {},
    meta: { needs: [], errors: [], updated_at: "2026-07-03T00:00:00.000Z" },
  };
}

describe("digital card — diseno credencial real", () => {
  const template = readFileSync(
    fileURLToPath(new URL("../../src/dc-templates/credencial.html", import.meta.url)),
    "utf8",
  );

  it("no deja marcadores {{ }} sin resolver", () => {
    const html = renderTemplate(template, buildCardView(sampleLead()));
    expect(html).not.toMatch(/\{\{/);
  });

  it("incluye nombre, tagline y about", () => {
    const html = renderTemplate(template, buildCardView(sampleLead()));
    expect(html).toContain("Dr. Pérez");
    expect(html).toContain("Cardiología");
    expect(html).toContain("Atención cardiológica.");
  });

  it("arma el link de WhatsApp con el numero pelado y mensaje precargado", () => {
    const html = renderTemplate(template, buildCardView(sampleLead()));
    expect(html).toContain('href="https://wa.me/525512345678?text=');
  });

  it("lista los servicios", () => {
    const html = renderTemplate(template, buildCardView(sampleLead()));
    expect(html).toContain("<li>Consulta</li>");
    expect(html).toContain("<li>Electrocardiograma</li>");
  });

  it("inyecta el color primario de la marca", () => {
    const html = renderTemplate(template, buildCardView(sampleLead()));
    expect(html).toContain("--primary: #0a1f44");
  });

  it("sin enlaces muestra el fallback (seccion invertida)", () => {
    const lead = sampleLead();
    lead.contact = {};
    lead.socials = {};
    // sin nombre tampoco hay vCard ("Guardar contacto"), que cuenta como enlace
    lead.business = { name: "", attrs: {} };
    const html = renderTemplate(template, buildCardView(lead));
    expect(html).toContain("Sin enlaces todavía");
  });
});

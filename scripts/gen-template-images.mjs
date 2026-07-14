// @ts-check
/**
 * gen-template-images.mjs — genera la libreria de imagenes placeholder para las
 * plantillas WEB (src/templates/), de forma DETERMINISTA (mismo principio del
 * repo: el arte reproducible va en codigo).
 *
 * Por que SVG y no fotos: (1) CLAUDE.md prohibe generar caras/fotos falsas de
 * personas; estos son PICTOGRAMAS planos (sin rostro), no retratos. (2) El
 * entorno bloquea descargar fotos de stock. (3) El repo es self-contained
 * (SVG inline / data URI). Cuando haya fotos reales con licencia, se pueden
 * dejar caer con el MISMO nombre de archivo y el manifest (doctor-images.ts)
 * las toma sin tocar codigo.
 *
 * Ejes que pidio el usuario:
 *  - Doctor por GENERO: male | female | neutral (default seguro).
 *  - Consultorio por ESPECIALIDAD: general | dental | aesthetic | surgeon.
 *  - Retrato de doctor tambien por especialidad (acento + insignia).
 *
 * Correr:  node scripts/gen-template-images.mjs
 * Salida:  src/templates/assets/doctors/*.svg  y  src/templates/assets/offices/*.svg
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DOCTORS_DIR = resolve(ROOT, "src/templates/assets/doctors");
const OFFICES_DIR = resolve(ROOT, "src/templates/assets/offices");

/** Especialidades soportadas (eje "tipo de doctor"). */
const SPECIALTIES = /** @type {const} */ (["general", "dental", "aesthetic", "surgeon"]);
/** Generos soportados (eje "hombre o mujer"); neutral es el default seguro. */
const GENDERS = /** @type {const} */ (["neutral", "female", "male"]);

/**
 * Paleta por especialidad. `coat` es el color de la bata/uniforme, `accent` el
 * de fondo/insignia. Elegidos con buen contraste sobre blanco.
 */
const THEME = {
  general: { accent: "#0e7490", coat: "#ffffff", tint: "#e0f2fe", ink: "#0b4a5c" },
  dental: { accent: "#0891b2", coat: "#ffffff", tint: "#cffafe", ink: "#155e75" },
  aesthetic: { accent: "#be185d", coat: "#fdf2f8", tint: "#fce7f3", ink: "#831843" },
  surgeon: { accent: "#047857", coat: "#d1fae5", tint: "#d1fae5", ink: "#064e3b" },
};

const SKIN = "#e7c6a5"; // tono neutro calido; sin rasgos faciales (pictograma)
const HAIR = "#3f3a36";

/** Insignia de especialidad (icono simple, 24x24 en su propio viewBox interno). */
function specialtyBadge(specialty, x, y, r, fill) {
  const cx = x;
  const cy = y;
  const inner = {
    // diente
    dental: `<path d="M ${cx - 6} ${cy - 5} C ${cx - 7} ${cy - 9}, ${cx - 1} ${cy - 9}, ${cx} ${cy - 6} C ${cx + 1} ${cy - 9}, ${cx + 7} ${cy - 9}, ${cx + 6} ${cy - 5} C ${cx + 7} ${cy + 3}, ${cx + 4} ${cy + 8}, ${cx + 3} ${cy + 3} C ${cx + 2} ${cy - 1}, ${cx - 2} ${cy - 1}, ${cx - 3} ${cy + 3} C ${cx - 4} ${cy + 8}, ${cx - 7} ${cy + 3}, ${cx - 6} ${cy - 5} Z" fill="${fill}"/>`,
    // bisturi
    surgeon: `<path d="M ${cx - 6} ${cy + 6} L ${cx + 3} ${cy - 3} L ${cx + 6} ${cy - 6} L ${cx + 4} ${cy - 1} L ${cx - 4} ${cy + 7} Z" fill="${fill}"/><rect x="${cx - 7}" y="${cy + 5}" width="4" height="3" rx="1" transform="rotate(-45 ${cx - 5} ${cy + 6})" fill="${fill}"/>`,
    // flor de 6 petalos (estetica) — distinta de la cruz medica
    aesthetic: `<g fill="${fill}"><circle cx="${cx + 5}" cy="${cy}" r="2.4"/><circle cx="${cx + 2.5}" cy="${cy + 4.3}" r="2.4"/><circle cx="${cx - 2.5}" cy="${cy + 4.3}" r="2.4"/><circle cx="${cx - 5}" cy="${cy}" r="2.4"/><circle cx="${cx - 2.5}" cy="${cy - 4.3}" r="2.4"/><circle cx="${cx + 2.5}" cy="${cy - 4.3}" r="2.4"/><circle cx="${cx}" cy="${cy}" r="2.6" fill="#ffffff"/></g>`,
    // cruz medica (general)
    general: `<path d="M ${cx - 2} ${cy - 6} h4 v4 h4 v4 h-4 v4 h-4 v-4 h-4 v-4 h4 Z" fill="${fill}"/>`,
  };
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" stroke="${fill}" stroke-width="1.5"/>${inner[specialty]}`;
}

/** Cabello segun genero, dibujado detras/alrededor de la cabeza (cx,cy,r). */
function hair(gender, cx, cy, r) {
  if (gender === "female") {
    // melena a los lados
    return `<path d="M ${cx - r - 4} ${cy + r + 8} C ${cx - r - 8} ${cy - r}, ${cx - r + 2} ${cy - r - 8}, ${cx} ${cy - r - 6} C ${cx + r - 2} ${cy - r - 8}, ${cx + r + 8} ${cy - r}, ${cx + r + 4} ${cy + r + 8} L ${cx + r - 2} ${cy + r + 8} C ${cx + r + 2} ${cy}, ${cx + r - 2} ${cy - r + 2}, ${cx} ${cy - r + 1} C ${cx - r + 2} ${cy - r + 2}, ${cx - r - 2} ${cy}, ${cx - r + 2} ${cy + r + 8} Z" fill="${HAIR}"/>`;
  }
  if (gender === "male") {
    // pelo corto: casquete que cubre la corona hasta las sienes
    return `<path d="M ${cx - r - 1} ${cy + 1} C ${cx - r - 1} ${cy - r * 1.25}, ${cx + r + 1} ${cy - r * 1.25}, ${cx + r + 1} ${cy + 1} C ${cx + r * 0.72} ${cy - r * 0.55}, ${cx - r * 0.72} ${cy - r * 0.55}, ${cx - r - 1} ${cy + 1} Z" fill="${HAIR}"/>`;
  }
  // neutral: gorro quirurgico (cubre pelo, sin genero)
  return `<path d="M ${cx - r - 2} ${cy} C ${cx - r - 3} ${cy - r - 7}, ${cx + r + 3} ${cy - r - 7}, ${cx + r + 2} ${cy} C ${cx + r} ${cy - 3}, ${cx - r} ${cy - 3}, ${cx - r - 2} ${cy} Z" fill="#7dd3fc"/>`;
}

/** Retrato pictograma de doctor: especialidad + genero. 240x240. */
function doctorSvg(specialty, gender) {
  const t = THEME[specialty];
  const W = 240;
  const cx = W / 2;
  const headR = 34;
  const headCy = 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" role="img" aria-label="Doctor ${specialty} ${gender} (ilustracion)">
  <defs>
    <clipPath id="c"><circle cx="${cx}" cy="${cx}" r="${cx}"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect width="${W}" height="${W}" fill="${t.tint}"/>
    <circle cx="${cx}" cy="${cx}" r="${cx - 6}" fill="#ffffff" opacity="0.55"/>
    <!-- torso / bata -->
    <path d="M ${cx - 78} ${W} L ${cx - 78} 196 C ${cx - 78} 156, ${cx - 34} 138, ${cx} 138 C ${cx + 34} 138, ${cx + 78} 156, ${cx + 78} 196 L ${cx + 78} ${W} Z" fill="${t.coat}" stroke="${t.accent}" stroke-width="2"/>
    <!-- solapa -->
    <path d="M ${cx} 140 L ${cx - 20} 176 L ${cx - 8} 190 Z" fill="${t.tint}"/>
    <path d="M ${cx} 140 L ${cx + 20} 176 L ${cx + 8} 190 Z" fill="${t.tint}"/>
    <!-- cuello -->
    <rect x="${cx - 12}" y="120" width="24" height="26" rx="10" fill="${SKIN}"/>
    <!-- estetoscopio -->
    <path d="M ${cx - 16} 148 C ${cx - 30} 176, ${cx - 8} 206, ${cx + 4} 190" fill="none" stroke="${t.accent}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="${cx + 6}" cy="192" r="7" fill="${t.accent}"/>
    <!-- cabeza (sin rostro) -->
    <circle cx="${cx}" cy="${headCy}" r="${headR}" fill="${SKIN}"/>
    ${hair(gender, cx, headCy, headR)}
    <!-- insignia de especialidad -->
    ${specialtyBadge(specialty, cx + 52, 184, 18, t.accent)}
  </g>
  <circle cx="${cx}" cy="${cx}" r="${cx - 1}" fill="none" stroke="${t.accent}" stroke-width="2"/>
</svg>
`;
}

/** Escena de consultorio por especialidad. 480x300. */
function officeSvg(specialty) {
  const t = THEME[specialty];
  const W = 480;
  const H = 300;
  const floorY = 214;
  const base = `<rect width="${W}" height="${H}" fill="${t.tint}"/>
    <rect y="${floorY}" width="${W}" height="${H - floorY}" fill="#eef2f5"/>
    <line x1="0" y1="${floorY}" x2="${W}" y2="${floorY}" stroke="${t.accent}" stroke-width="2" opacity="0.4"/>
    <!-- ventana -->
    <rect x="40" y="46" width="120" height="86" rx="6" fill="#ffffff" stroke="${t.accent}" stroke-width="3"/>
    <line x1="100" y1="46" x2="100" y2="132" stroke="${t.accent}" stroke-width="2" opacity="0.5"/>
    <line x1="40" y1="89" x2="160" y2="89" stroke="${t.accent}" stroke-width="2" opacity="0.5"/>
    <!-- cruz de rotulo -->
    <g transform="translate(410,60)"><rect x="-16" y="-6" width="32" height="12" rx="3" fill="${t.accent}"/><rect x="-6" y="-16" width="12" height="32" rx="3" fill="${t.accent}"/></g>`;

  const props = {
    // camilla de exploracion
    general: `<rect x="250" y="150" width="180" height="20" rx="6" fill="${t.accent}"/>
      <rect x="250" y="120" width="70" height="34" rx="8" fill="#ffffff" stroke="${t.accent}" stroke-width="3"/>
      <rect x="262" y="170" width="8" height="44" fill="${t.ink}"/><rect x="410" y="170" width="8" height="44" fill="${t.ink}"/>
      <circle cx="150" cy="180" r="8" fill="${t.accent}"/><rect x="120" y="188" width="60" height="26" rx="6" fill="#ffffff" stroke="${t.accent}" stroke-width="3"/>`,
    // sillon dental + lampara
    dental: `<path d="M 250 200 C 250 150, 360 150, 372 190 L 380 214 L 250 214 Z" fill="${t.accent}"/>
      <rect x="330" y="120" width="26" height="70" rx="8" fill="#ffffff" stroke="${t.accent}" stroke-width="3"/>
      <circle cx="300" cy="96" r="20" fill="#fde68a" stroke="${t.accent}" stroke-width="3"/>
      <line x1="300" y1="116" x2="300" y2="150" stroke="${t.ink}" stroke-width="4"/>
      <line x1="300" y1="116" x2="240" y2="132" stroke="${t.ink}" stroke-width="4"/>
      <rect x="250" y="200" width="150" height="14" rx="4" fill="${t.ink}"/>`,
    // camilla de spa + planta + espejo
    aesthetic: `<rect x="250" y="168" width="190" height="18" rx="9" fill="${t.accent}"/>
      <rect x="250" y="150" width="60" height="20" rx="10" fill="#ffffff" stroke="${t.accent}" stroke-width="3"/>
      <rect x="262" y="186" width="8" height="28" fill="${t.ink}"/><rect x="420" y="186" width="8" height="28" fill="${t.ink}"/>
      <rect x="196" y="150" width="30" height="64" rx="4" fill="#ffffff" stroke="${t.accent}" stroke-width="3"/>
      <g transform="translate(150,214)"><rect x="-10" y="-30" width="20" height="30" rx="4" fill="${t.accent}"/><path d="M 0 -30 C -22 -46, -22 -76, 0 -70 C 22 -76, 22 -46, 0 -30 Z" fill="#34d399"/></g>`,
    // mesa de quirofano + lampara cieletica
    surgeon: `<rect x="250" y="176" width="200" height="18" rx="6" fill="${t.accent}"/>
      <rect x="256" y="194" width="10" height="20" fill="${t.ink}"/><rect x="436" y="194" width="10" height="20" fill="${t.ink}"/>
      <g transform="translate(340,86)"><line x1="0" y1="0" x2="0" y2="30" stroke="${t.ink}" stroke-width="5"/><circle cx="-22" cy="34" r="16" fill="#ecfeff" stroke="${t.accent}" stroke-width="3"/><circle cx="14" cy="40" r="16" fill="#ecfeff" stroke="${t.accent}" stroke-width="3"/></g>
      <rect x="150" y="150" width="46" height="64" rx="6" fill="#ffffff" stroke="${t.accent}" stroke-width="3"/><line x1="150" y1="176" x2="196" y2="176" stroke="${t.accent}" stroke-width="2"/>`,
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Consultorio ${specialty} (ilustracion)">
  ${base}
  ${props[specialty]}
</svg>
`;
}

// ---- emit --------------------------------------------------------------
mkdirSync(DOCTORS_DIR, { recursive: true });
mkdirSync(OFFICES_DIR, { recursive: true });

let count = 0;
for (const specialty of SPECIALTIES) {
  for (const gender of GENDERS) {
    const file = resolve(DOCTORS_DIR, `doctor-${specialty}-${gender}.svg`);
    writeFileSync(file, doctorSvg(specialty, gender), "utf8");
    count++;
  }
  const officeFile = resolve(OFFICES_DIR, `office-${specialty}.svg`);
  writeFileSync(officeFile, officeSvg(specialty), "utf8");
  count++;
}

console.log(`Generadas ${count} imagenes:`);
console.log(`  ${SPECIALTIES.length * GENDERS.length} retratos -> ${DOCTORS_DIR}`);
console.log(`  ${SPECIALTIES.length} consultorios -> ${OFFICES_DIR}`);

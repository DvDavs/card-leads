# card-leads

Pipeline CLI (TypeScript / Node) que convierte fotos de tarjetas de presentacion
en una digital card (dc) -- varios disenos listos con un visor swipeable -- y,
a futuro, una web publicada. Cada etapa es un comando independiente; el estado
vive en un `data.json` por lead dentro de `leads/<slug>/`.

## Estado actual

Rebanada vertical implementada: **`ingest` -> `build-cards`**. El resto de
las etapas son stubs que lanzan `"no implementado"`. LLM, deploy y Telegram
todavia no estan.

## Requisitos

- Node 20+ (probado en 24)
- `npm install`

## Uso

```bash
# 1) ingerir una tarjeta: crea leads/<slug>/, copia imagenes, escribe data.json
npm run cli -- ingest ./ruta/frente.jpg ./ruta/reverso.jpg --rubro doctor --slug dr-perez

# slug y rubro son opcionales:
#   - slug: si falta, se deriva del nombre del archivo del frente
#   - rubro: si falta, "otro" (queda anotado en meta.needs)

# 2) rellenar TODOS los disenos del pool -> leads/<slug>/dc/*.html + dc/index.html
npm run cli -- build-cards dr-perez
```

Salida de `ingest`: `status="ingested"`, campos de negocio vacios y `meta.needs`
con lo que falta (el LLM aun no llena nada). `build-cards` rellena cada
`.html` de `src/dc-templates/` con los datos del lead, arma el visor
swipeable (`dc/index.html`) y deja `status="linktree_built"` (nombre de
status heredado del linktree original, por compatibilidad).

## Estructura

```
src/
  cli.ts            entrypoint, rutea a las etapas
  stages/           una etapa por archivo (ingest, extract, build-*, deploy, ...)
  lib/
    schema.ts       Zod: fuente de verdad del tipo Lead (el tipo se infiere)
    slug.ts         genera/valida slugs (puro)
    template.ts     motor {{variables}} minimalista (puro)
    storage.ts      leer/escribir data.json y la carpeta del lead
    llm/            interfaz de proveedor + stubs (openai, gemini)
  prompts/          prompts de vision/copy/propuesta (borradores)
  dc-templates/     pool de disenos de digital card (clinic/dark/executive/
                    luxury/credencial) + _viewer.html (visor swipeable)
  templates/        HTML con {{variables}} para build-web (stub), por rubro
    assets/         imagenes placeholder (SVG) doctor por genero + consultorio
                    por especialidad; selector en config/doctor-images.ts
  config/rubro-map  rubro -> template web + servicios/ideas base + CARD_LABELS
  config/doctor-images  selector de imagenes por genero/especialidad (puro)
leads/              datos de terceros (gitignored)
tests/
  deterministic/    slug, template, schema, build-cards, ...
  evals/            golden de LLM (pendiente)
```

## Tests

```bash
npm test          # vitest run (deterministas)
npm run typecheck # tsc --noEmit
```

## Notas de diseno

- **El tipo `Lead` se infiere del schema Zod**, no se declara a mano: validacion
  en runtime y tipos en compile-time no pueden divergir.
- `LEADS_DIR` (env) permite apuntar la raiz de leads a otra carpeta (tests).
- Sin paso de build: se ejecuta el TS directo con `tsx`.
- Las digital cards son self-contained (sin JS, sin dependencias de build) con
  UNA excepcion: los disenos `clinic`/`dark`/`executive`/`luxury` cargan
  Google Fonts via `<link>` para preservar su identidad tipografica; el
  diseno `credencial` sigue sin fuentes remotas.

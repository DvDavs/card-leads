# card-leads

Pipeline CLI (TypeScript / Node) que convierte fotos de tarjetas de presentacion
en un linktree + web. Cada etapa es un comando independiente; el estado vive en
un `data.json` por lead dentro de `leads/<slug>/`.

## Estado actual

Rebanada vertical implementada: **`ingest` -> `build-linktree`**. El resto de
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

# 2) construir el linktree desde data.json -> leads/<slug>/linktree.html
npm run cli -- build-linktree dr-perez
```

Salida de `ingest`: `status="ingested"`, campos de negocio vacios y `meta.needs`
con lo que falta (el LLM aun no llena nada). `build-linktree` rellena el template
generico y deja `status="linktree_built"`.

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
  templates/        HTML con {{variables}} (generico = linktree)
  config/rubro-map  rubro -> template + servicios/ideas base
leads/              datos de terceros (gitignored)
tests/
  deterministic/    slug, template, schema
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

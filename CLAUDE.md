# card-leads — memoria del proyecto

Este archivo orienta a Claude Code al abrir una sesión nueva sobre este repo.
Está derivado del código real (no de intenciones); si algo cambia en el
código y este archivo queda desactualizado, gana el código — actualizar este
archivo en ese caso.

Idioma de este archivo: español neutro. Ver `AGENTS.MD` — no usar
vocabulario argentino (ni voseo) en el código, commits ni documentación de
este repo.

## Qué es el proyecto

CLI en TypeScript (Node + pnpm) que convierte fotos de una tarjeta de
presentación en una **digital card (dc)** — varios diseños listos para que el
cliente elija, con un visor swipeable — y, a futuro, una web publicada. Sirve
para cualquier rubro (doctor, barbería, estética, veterinario, nutriólogo,
"otro"), no solo consultorios médicos. Es un generador de leads: se parte de
una tarjeta física y se llega a una presencia web (la demo de digital cards)
que se le muestra al negocio como propuesta comercial.

## Arquitectura y principios

- **Pipeline de etapas CLI independientes, no un orquestador.** Cada etapa
  es un comando separado (`pnpm cli <etapa> <slug>`), se testea aislada y se
  puede reanudar desde donde quedó un lead sin repetir las etapas previas.
- **El estado vive en `leads/<slug>/data.json`.** Es la fuente de verdad de
  ese lead; la carpeta `leads/<slug>/` es su "expediente" (fotos + JSON +
  artefactos generados, entre ellos `dc/<template>.html` por cada diseño y
  `dc/index.html`, el visor swipeable).
- **`leads/` está gitignoreado.** Contiene PII de terceros (nombres,
  teléfonos, direcciones, email). Nunca commitear nada de ahí.
- **Máquina de estados por `status`** (`src/lib/schema.ts`, `StatusSchema`),
  secuencia real que recorre un lead:
  `ingested → extracted → verified → linktree_built → web_built → deployed → proposal_ready → packaged`
  (más `error` como estado de escape). Cada etapa exige el status anterior y
  avanza al siguiente; si el status no matchea, la etapa lanza y no toca
  disco.
- **Principio rector: lo determinista va en código, lo interpretativo va al
  LLM.**
  - Texto de la tarjeta (nombre, teléfonos, redes, servicios) → LLM
    (Gemini), porque es lectura/interpretación de una foto real.
  - Servicios cuando la tarjeta NO los enumera → **catálogo fijo por rubro**
    (`rubroConfig(rubro).defaultServices`, `src/config/rubro-map.ts`), NO el
    LLM. El prompt (`extract-card.md`) le sigue prohibiendo al modelo inventar
    servicios que no ve; si la tarjeta no trae ninguno, `applyExtraction`
    (`extract.ts`) rellena con la lista fija de ese rubro (p.ej. veterinario →
    "Consulta, Vacunacion, Urgencias") para que la card no salga vacía. Mismo
    principio que los colores: inventar una lista de servicios típicos por
    rubro es dato determinista (catálogo en código), no interpretación de
    imagen. Rubros sin default (`otro`) quedan vacíos igual que antes. Queda
    anotado en `meta.needs` (`"servicios sugeridos por rubro..."`) y `verify`
    lo marca `⚠ SUGERIDOS POR RUBRO, NO ESTABAN EN LA TARJETA` para que el
    humano los confirme o los reemplace en el checkpoint.
  - Colores de marca → **medición de píxeles** con `colorthief` + `sharp`
    (`src/lib/colors.ts`), NO el LLM. El LLM ESTIMABA hex muy mal (le decía
    "negro" a un verde), porque el color no es tarea de lenguaje. Los hex
    siempre salen de la medición. Ver más abajo, es una decisión ya tomada y
    probada.
  - Asignación de rol de color (¿cuál hex medido es `primary`/`secondary`/
    `accent`/`background`/`surface`/`text`?) → **LLM con visión**, eligiendo de
    la paleta MEDIDA (`extractPalette` → prompt de `extract`). El LLM nunca
    inventa un hex: `resolveAssignedColors` (`colors.ts`) descarta cualquier hex
    que no esté en la paleta (la baranda). Reemplaza a la heurística `brandWeight`
    para captar la identidad de la tarjeta; `brandWeight` queda como FALLBACK si
    el LLM falla o no hay paleta. Esto respeta el principio rector: medir es
    determinista (código), asignar el rol es interpretativo (LLM).
  - Relleno de templates (digital cards en `leads/<slug>/dc/*.html`) →
    templating puro (`src/lib/template.ts`), sin LLM.
- **Checkpoint humano obligatorio (`verify`).** El modelo barato
  (`gemini-2.5-flash`) falla de forma **aleatoria** en campos finos (un
  dígito de teléfono, un handle de red inventado), distinto en cada corrida,
  así que no se puede cachear ni saltear con más prompt-engineering. `verify`
  muestra primero los campos de riesgo (teléfonos, whatsapp, redes, colores)
  marcados `⚠ VERIFICAR CONTRA LA TARJETA` y no escribe nada hasta que el
  humano confirma (`s`/`si`). Esto **no es opcional** y no debe quitarse ni
  "optimizarse" para automatizar de punta a punta.

## El estado: `Lead` (`src/lib/schema.ts`)

El tipo `Lead` se **infiere** del schema Zod (`z.infer<typeof LeadSchema>`),
no se declara a mano — así el runtime (validación) y el compile-time (tipos)
no pueden divergir. `parseLead()` es el único punto de entrada para validar
un `data.json` crudo.

Campos principales:

| Campo | Qué es |
|---|---|
| `slug` | Clave del lead (kebab-case), nombre de su carpeta en `leads/`. |
| `status` | Estado en la máquina de estados (ver arriba). |
| `rubro` | Enum: `doctor · barberia · estetica · veterinario · nutriologo · otro`. |
| `source` | Rutas a `card_front`/`card_back` (relativas a la carpeta del lead), `ingested_at`, `channel` (`telegram`\|`manual`). |
| `business` | `name` (string, puede quedar vacío hasta `extract`), `person_name`, `tagline`, `attrs` (libre por rubro). |
| `contact` | `phones` (**lista**, no un solo string — un consultorio puede tener varios), `whatsapp` (uno solo), `email`, `address`, `website`. |
| `socials` | `facebook`, `instagram`, `tiktok`, `other`. |
| `brand.palette` | Lista de hex **medidos** de la foto (`extractPalette`, hasta 8). Es la fuente de candidatos que se le pasa al LLM para asignar roles; opcional (data.json viejos no la tienen). |
| `brand.colors` | Hex por ROL: `primary`/`secondary`/`accent` (los que usan las cards hoy) + `background`/`surface`/`text` (asignados pero aún sin usar en templates). El hex sale de `palette` (medido); el ROL lo asigna el LLM con visión, validado contra la paleta. Todos editables en `verify`. |
| `brand.colorsText` | Color de texto legible (`#ffffff`/`#000000`, WCAG) **derivado** de cada hex de `colors` que sea SUPERFICIE (`primary`…`surface`); `text` es tinta y no lo lleva. Se recalcula, nunca se edita a mano. |
| `brand.has_logo`, `brand.font_hint` | Sí los aporta el LLM (`font_hint` es pista: "serif"/"sans"/"display", no exacto). |
| `brand.logo_path`, `brand.photo_path` | Rutas (relativas al lead o data URI) al logo y a una foto real. Alimentan el avatar circular del pool decorativo con cascada `photo_path` → `logo_path` → inicial. Opcionales; **nunca** una cara/foto generada, solo material real del negocio. |
| `content.services` | Lista de servicios. Si la tarjeta los enumera, vienen del LLM; si no, `extract` los rellena con el default fijo del rubro (`rubroConfig`) y lo anota en `meta.needs` para que `verify` los confirme. |
| `generated` | URLs/paths de artefactos generados: `dc_url` (visor swipeable, `dc/index.html`), `cards` (lista `{template, path}`, una por diseño rellenado en `dc/`), `linktree_url` (legado, pre digital-cards), `web_url`, `proposal_path`, `outreach_message`. |
| `meta.needs` | Huecos pendientes para el checkpoint humano (recalculado en cada etapa, no es un diff acumulado). |
| `meta.errors` | Errores de la última corrida (p.ej. el modelo no devolvió JSON válido). |

**Migración automática:** los `data.json` viejos con `contact.phone` (string
único) se migran a `contact.phones` (lista) al leer, vía `z.preprocess` en
`ContactSchema` (`migrateContact` en `schema.ts`). Es idempotente y además
separa por coma si el string viejo traía varios números pegados. No hace
falta correr nada a mano.

## Las etapas (`src/stages/*.ts`)

| Etapa | Exige status | Deja status | LLM | Qué hace |
|---|---|---|---|---|
| `ingest` | (nuevo) | `ingested` | no | Crea `leads/<slug>/`, copia las fotos como `card_front.<ext>`/`card_back.<ext>`, escribe `data.json` con los campos de negocio vacíos. `rubro` default `"otro"` si no se pasa (queda anotado en `meta.needs`). |
| `extract` | `ingested` | `extracted` | sí (Gemini) | (1) **Mide** la paleta con `extractPalette` (`colors.ts`, píxeles). (2) Manda las fotos + la paleta al proveedor de visión: el LLM llena `business`/`contact`/`socials`/`content.services` Y **asigna roles de color** eligiendo hex de la paleta. (3) `resolveAssignedColors` valida (hex ∈ paleta); si el LLM no asignó nada válido cae a la heurística `extractBrandColors`. Los hex NUNCA los inventa el LLM. (4) Si el LLM no vio servicios en la tarjeta (`content.services: []`), `applyExtraction` cae al default fijo de `rubroConfig(rubro).defaultServices` (rubro ya corregido por el modelo si aplica) y lo anota en `meta.needs`. Si la respuesta no parsea, registra en `meta.errors` y **no** avanza el status (queda `ingested` para reintentar). |
| `verify` | `extracted` | `verified` | no | Checkpoint humano interactivo por terminal (`readline`). Recorre primero los campos de riesgo, después los generales; al confirmar (`s`) valida contra `LeadSchema` estricto y recién ahí escribe disco. `n`/Ctrl+C no escribe nada. |
| `build-cards` | `verified` o posterior (excluye `error`; orden por índice en `StatusSchema`) | `linktree_built` (se mantiene ese nombre de status por compatibilidad; no retrocede si el lead ya estaba más adelante) | no | Recorre **todos** los `*.html` de `src/dc-templates/` (el pool; los que empiezan con `_` se saltan) y rellena cada uno con la vista de `buildCardView`: paleta + `colorsText` (WCAG), WhatsApp derivado de `phones[0]` si falta (`DEFAULT_COUNTRY_CODE = 52`), botón "Guardar contacto" (vCard como data URI) en el diseño `credencial`, dirección → Google Maps, JSON-LD por rubro. Antes de rellenar, **swap de motivos por rubro**: `swapMotif` reemplaza el bloque `MOTIF:START…MOTIF:END` que trae cada diseño decorativo por el del `lead.rubro` (leído de `_motifs.html` vía `parseMotifs`/`loadMotifs`), así todos los diseños que ve el cliente muestran motivos coherentes con su rubro; los diseños sin marcadores quedan intactos (no-op). Escribe `leads/<slug>/dc/<template>.html` por cada diseño más `leads/<slug>/dc/index.html` (visor swipeable, carrusel de iframes), y **espeja** `src/dc-templates/assets/` en `leads/<slug>/dc/assets/` (`copyTreeIntoLead`) para los diseños con imágenes propias (guelaguetza-*). No filtra por rubro: cada lead recibe TODOS los diseños del pool. Agregar un diseño nuevo = tirar un `.html` más en `src/dc-templates/`, sin tocar código (si trae imágenes, van a `src/dc-templates/assets/` y se copian solas). |
| `build-web` | — | `web_built` | — | **Stub**, lanza `"no implementado"`. Cuando exista: va a usar el template por rubro (`rubroConfig(rubro).webTemplate`). |
| `deploy` | — | `deployed` | — | **Stub**, lanza `"no implementado"`. |
| `proposal` | — | `proposal_ready` | — | **Stub**, lanza `"no implementado"`. |
| `package` | `linktree_built` o posterior (excluye `error`; orden por índice en `StatusSchema`) | `packaged` | no | Arma el **mensaje de contacto** para WhatsApp (`buildOutreachMessage`, `src/lib/outreach.ts`, puro) y lo guarda en `generated.outreach_message`. Dos partes: apertura (saludo `Hola, buen día <nombre>` + gancho + enlaces públicos `https://cards.kronet.app/<slug>`, más el sitio web solo si el lead trae `generated.web_url`) y seguimiento (menú fijo de otros sistemas — agenda de citas, bot de WhatsApp 24/7, CRM, contable, anuncios en redes — con el propio entregable como prueba). NO exige `web_built` a propósito (`build-web` es stub, ningún lead lo alcanza); basta con que `build-cards` haya corrido. El CLI imprime front y back para copiar/pegar. |

Confirmado leyendo `src/stages/build-web.ts`, `deploy.ts` y `proposal.ts`: los
tres son literalmente `throw new Error("...: no implementado")`, sin lógica
todavía. `package.ts` **ya está implementado** (mensaje de contacto, ver arriba).

## `src/dc-templates/` — pool de diseños de digital card

Cada `.html` de esta carpeta (menos los que empiezan con `_`) es un diseño
completo, standalone, que `build-cards` rellena con `buildCardView` y escribe
en `leads/<slug>/dc/<nombre>.html`. Hoy hay **14**: los base `clinic`, `dark`,
`executive`, `luxury` y `credencial` (el original del linktree, el único
self-contained sin fuentes remotas), el **pool decorativo** `celeste`,
`vitrina`, `rotulo`, `seda`, `redondo`, `lienzo`, y los **Guelaguetza**
`guelaguetza-calenda`, `guelaguetza-pina`, `guelaguetza-tehuana` (público
objetivo por diseño en `CARD_LABELS`, `src/config/rubro-map.ts`). El pool
decorativo agrega dos capas nuevas: avatar circular con cascada foto → logo →
inicial (campo `photoPath`) y una capa de motivos decorativos intercambiable
por rubro (ver abajo). `_viewer.html` es el visor: arma un carrusel de `<iframe>` (cada card
queda intacta como archivo standalone) con swipe (Pointer Events +
`setPointerCapture` recién al confirmar gesto horizontal, para no robarle el
tap a los botones de adentro de la card), flechas, dots y
`document.startViewTransition()` para el crossfade del chip de etiqueta.
`@view-transition{navigation:auto}` (CSS) NO se usa a propósito: es para
navegaciones MPA vía la Navigation API y no puede cruzar el borde de un iframe.

**Toggle "Ver con los colores de tu marca" (colores originales ⇄ colores de
marca, en runtime, sin rebuild).** Cada card configurable declara DOS
paletas en su CSS: `:root { ... }` con la paleta ORIGINAL del diseño (hex
hardcodeado; es el default, toggle apagado) y `:root[data-brand] { ... }`
con la paleta de MARCA (los `{{{colors.*}}}`/`{{{colorsText.*}}}` que antes
vivían directo en `:root`). Los neutros derivados (`--bg`/`--ink`/`--line`,
que en casi todos los diseños son `color-mix(..., var(--primary) ...)`) NO
se duplican: al sobreescribir `--primary` en `[data-brand]` recalculan
solos. `build-cards` inyecta en cada card, en build time, un `<script>`
idéntico (`BRAND_TOGGLE_SNIPPET`/`injectBrandToggle`, puro) que escucha
`postMessage({type:'dc-brand', on})` y hace
`document.documentElement.toggleAttribute('data-brand', on)`; al cargar
avisa `{type:'dc-brand-ready'}` al padre para que el visor le conteste el
estado actual (cubre los iframes que cargan lazy al hacer swipe, sin
parpadeo). El control vive en `_viewer.html` (`.brand-toggle`, zona superior
del `.hud`, antes vacía): arranca APAGADO (colores originales) y al
prenderlo muestra una advertencia fija — los colores de marca los mide una
IA desde la foto de la tarjeta y pueden fallar. Es 100% cliente: no rehorna
nada en `data.json` ni en disco. Diseño nuevo que quiera soportar el toggle
= declarar su paleta original en `:root` + un `:root[data-brand]` con los
`{{{colors.*}}}` (ver `LEEME-nuevos.md`); el listener se inyecta solo.

**Capa de motivos (`_motifs.html`, fondos intercambiables por rubro).**
`_motifs.html` (prefijo `_` ⇒ fuera del pool) es la LIBRERÍA: un bloque de
arte SVG por rubro (`doctor`, `nutriologo`, `barberia`, `estetica`,
`veterinario`, `otro`), cada uno con el wrapper `.motif` y los sprites
`.m1`–`.m5`. Cada diseño decorativo trae un bloque default entre los
marcadores `<!-- MOTIF:START (rubro=X) -->` y `<!-- MOTIF:END -->` al inicio
del `<body>`. En `build-cards`, `swapMotif` (puro) lo reemplaza por el bloque
del `lead.rubro` (fallback a `otro`); el color y la posición los pone el CSS
de cada diseño (`currentColor` → paleta de marca), los bloques no llevan
variables de template. El diseñador lo pensó como swap manual (copiar/pegar);
en el pipeline es **automático por rubro**.

**Diseños Guelaguetza (Oaxaca) — arte fijo + assets propios.** `guelaguetza-*`
son un caso aparte del pool decorativo: paleta y arte de color son **FIJOS**
(hardcodeados en su `:root`) — esa paleta fija ES su "original" para el
toggle de marca. Se ofrecen en TODOS los rubros (como el resto del pool) y
son **estáticos por rubro**: solo cambian los DATOS del lead y la capa de
motivos (`_motifs.html`, teñida con un color fijo de su paleta). Traen
imágenes reales (`assets/guelaguetza/*.png`) referenciadas por ruta RELATIVA
— recursos EXCLUSIVOS de estos diseños, ningún otro los usa. Por eso
`build-cards` espeja `src/dc-templates/assets/` en `leads/<slug>/dc/assets/`
(`copyTreeIntoLead` en `storage.ts`), para que esas rutas resuelvan dentro
del iframe del visor. Son la única excepción a la regla self-contained en
cuanto a IMÁGENES (el resto usa SVG inline / data URI); los assets se copian
una vez por lead. **Toggle de marca:** a diferencia del resto del pool, el
`:root` base de estos tres NO trae placeholders — es la paleta Oaxaca
completa, siempre hardcodeada. Solo el rol "primario" de cada uno
(`--uva`/`--magenta`/`--oro`, según el diseño) tiene un `:root[data-brand]`
que lo mapea a `colors.primary` (+ su `-text` a `colorsText.primary`, para no
perder contraste). El resto del arte —confeti, picado, PNG— es fijo y NO se
recolorea por CSS: con el toggle prendido el chrome (CTA, avatar, links) usa
la marca pero las imágenes siguen en paleta Oaxaca; es una mezcla aceptada a
propósito, no un bug.

**Excepción de self-contained:** todos los diseños salvo `credencial` traen
`<link>` a Google Fonts (Anton, Newsreader, Cormorant Garamond, Oswald,
Fredoka, Instrument Serif, etc.) — decisión explícita del usuario para
preservar la identidad tipográfica de cada diseño. Es la ÚNICA excepción a la
regla self-contained (fuentes) del resto del repo; `credencial` (heredera del
linktree) sigue sin fuentes remotas.

`buildCardView` (en `build-cards.ts`) es un objeto SUPERSET: expone tanto los
campos del diseño `credencial` (`name`, `personName`, `links`, `address`
objeto, `fontFamily`...) como campos planos para los diseños nuevos
(`heroName`, `hasOrgLine`, `hasPhone`, `whatsappUrl`, `attrs`
`[{key,value}]`, `hasSocials`...). Un campo ausente en el lead nunca se
muestra vacío: su `{{#hasX}}` correspondiente simplemente no renderiza.

## `src/lib/` — piezas de soporte

- **`colors.ts`** — mide colores de marca con `colorthief`+`sharp` en vez de
  pedírselos al LLM. Separa MEDICIÓN de SELECCIÓN de rol:
  - `extractPalette()` — MIDE: devuelve la paleta rica (hasta `MAX_PALETTE`=8
    hex, deduplicada, sin blanco de fondo). Es lo que se le pasa al LLM.
  - `resolveAssignedColors(asignados, paleta)` — LA BARANDA (pura): toma la
    asignación rol→hex del LLM y solo acepta un rol si su hex EXISTE en la
    paleta medida (normalizado); descarta hex inventados. Calcula `textColor`
    (WCAG) para los roles de superficie. `BRAND_ROLES`/`SURFACE_ROLES` son la
    fuente de verdad de los roles.
  - `extractBrandColors()` + `brandWeight()` — FALLBACK heurístico (se usa si el
    LLM no asignó nada válido o no hubo paleta). Puntúa cada candidato por
    saturación + área + oscuridad, penalizando los muy claros (papel/fondo) para
    que no ganen `primary`. Umbrales tuneables en el archivo (`LIGHT_HARD_L`,
    `LIGHT_SOFT_L`, `DARK_REF_L`, `AREA_REF`, `MIN_ROLE_DIST`); `secondary`/
    `accent` con distancia RGB mínima para no repetir tonos casi iguales.
  Si colorthief/sharp fallan, no crashea el pipeline: `extract.ts` atrapa el
  error y deja los colores vacíos (`meta.needs` lo anota).
- **`storage.ts`** — todo el I/O de disco de un lead. Raíz configurable por
  `LEADS_DIR` (env), usado por los tests para aislar en un directorio
  temporal. `readLead`/`writeLead` siempre validan contra `LeadSchema`
  (nunca se puede persistir un lead que rompa el schema).
- **`slug.ts`** — `slugify` (normaliza acentos, kebab-case), `isValidSlug`,
  `slugFromFilename` (deriva el slug del nombre del archivo del frente si no
  se pasa `--slug`). Puro, sin I/O.
- **`template.ts`** — motor de templates propio, subconjunto tipo mustache
  (`{{var}}`, `{{{raw}}}`, `{{#section}}`, `{{^inverted}}`, `{{.}}`). Sin
  dependencias externas. Puro y determinista.
- **`llm/`** — interfaz común `VisionProvider` + switch por
  `LLM_PROVIDER` (env, default `gemini`). `gemini.ts` pega directo al REST
  API de Google (sin SDK, `fetch` nativo) con `gemini-2.5-flash` por
  defecto; fuerza `thinkingBudget: 0` porque los modelos `gemini-2.5-*`
  gastan tokens de salida "pensando" antes de escribir y eso cortaba el JSON
  a la mitad con un `maxOutputTokens` chico. `openai.ts` es un **stub**
  deliberado (lanza "no implementado"; queda pensado para `gpt-4o-mini`).
  `extraction.ts` define el contrato de salida del modelo (`ExtractionSchema`,
  todo `.nullish()` porque el modelo llena solo lo que ve) y
  `parseExtraction()`, que nunca lanza — enruta cualquier fallo a
  `{ ok: false, error }` para que `extract.ts` lo registre en `meta.errors`.

## Convenciones técnicas

- **pnpm**, no npm (hay `pnpm-lock.yaml`; con npm los args van tras `--`).
- Sin paso de build: se corre TypeScript directo con `tsx`.
- Node **≥ 20.12** (usa `process.loadEnvFile` nativo en `src/lib/env.ts`);
  probado en Node 24.
- Proveedor de LLM conmutable por env var `LLM_PROVIDER` (`gemini` por
  default; `openai` es stub). Llave en `.env` (gitignoreado, nunca
  hardcodear ni pegar llaves en el código o en el chat).
- El tipo `Lead` se infiere del schema Zod — nunca declarar una interfaz
  paralela a mano; editar el schema y dejar que el tipo se derive.
- Tests en `tests/deterministic/`: aserciones estrictas (TDD real) sobre
  lógica pura — `slug.test.ts`, `template.test.ts`, `schema.test.ts`,
  `colors.test.ts`, `extract.test.ts`, `verify.test.ts`, `build-cards.test.ts`
  (vista `buildCardView` + render real de cada diseño del pool + el visor).

## Sobre `tests/evals/` — discrepancia encontrada

El resumen que se pidió documentar asumía una carpeta `tests/evals/` para
golden examples de salida del LLM, separada de `tests/deterministic/`. **Al
explorar el código esa carpeta no existe todavía**: solo hay
`tests/deterministic/`. El propio `README.md` la lista como pendiente
("`evals/` — golden de LLM (pendiente)"). Documentado acá tal cual está hoy;
si se crea `tests/evals/` más adelante, actualizar esta sección.

## Cómo correr

```powershell
pnpm install
Copy-Item .env.example .env       # completar GEMINI_API_KEY
pnpm cli ingest anverso.jpg reverso.jpg --slug dr-karey --rubro doctor
pnpm cli extract dr-karey          # llama a Gemini -> status=extracted
pnpm cli verify dr-karey           # checkpoint humano -> status=verified
pnpm cli build-cards dr-karey      # -> leads/dr-karey/dc/*.html + dc/index.html
```

Comandos (firma real, `src/cli.ts`):

| Comando | Firma | Requiere API key |
|---|---|---|
| `pnpm cli ingest` | `ingest <front> [back] [--slug s] [--rubro r] [--channel c] [--force]` | no |
| `pnpm cli extract` | `extract <slug>` | sí (`GEMINI_API_KEY`) |
| `pnpm cli verify` | `verify <slug>` | no |
| `pnpm cli build-cards` | `build-cards <slug>` | no |
| `pnpm cli package` | `package <slug>` (mensaje de contacto para WhatsApp) | no |
| `pnpm cli build-web` \| `deploy` \| `proposal` | `<comando> <slug>` | — (stubs) |
| `pnpm test` | suite determinista (vitest) | no |
| `pnpm typecheck` | `tsc --noEmit` | no |

Rubros válidos: `doctor · barberia · estetica · veterinario · nutriologo ·
otro`. Solo `doctor`, `barberia` y `estetica` tienen template web propio hoy
(`src/templates/`, para `build-web`, todavía stub); `veterinario`,
`nutriologo` y `otro` caen al template `generico` ahí. Las digital cards
(`build-cards`) son independientes de esto: NO se filtran por rubro, cada
lead recibe todos los diseños de `src/dc-templates/`.

## Decisiones pendientes / cosas a saber

- `contact.phones` es lista (no un string único) porque un consultorio
  suele tener varios números; cada uno genera su propio botón "Llamar" en el
  diseño `credencial` (los otros diseños usan solo `phones[0]`).
- Para `build-web` (futuro): la idea es un **Tier A** automático (template +
  datos, para volumen) y un **Tier B** a mano con Claude Code para los leads
  que valen la pena más atención. No generar caras/fotos falsas de personas:
  usar placeholder o el logo real del negocio.
- Escala futura: servir cada lead por subdominio (`slug.dominio`) vía
  Cloudflare.
- `openai` como segundo proveedor de LLM queda pendiente (stub ya con la
  interfaz lista en `src/lib/llm/openai.ts`).

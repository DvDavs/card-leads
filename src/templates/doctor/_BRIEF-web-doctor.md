# Brief / contrato de plantillas web del rubro `doctor` (`src/templates/doctor/`)

Este documento es EL contrato bloqueante del pool de plantillas web del rubro
doctor. Es el registro de placeholders + las reglas de autoría. Todo agente que
re-parametrice una plantilla, y todo el código que la alimenta
(`build-web` → `buildWebView`, `enrich` → `write-copy.md`, los tests de
invariantes), implementan lo que dice acá. Si un dato no está en este registro,
NO existe para las plantillas. Si hay ambigüedad, se resuelve acá primero — no en
la plantilla.

Modelo mental: es el equivalente web del brief de digital cards
(`src/dc-templates/_BRIEF-nuevo-diseno.md`). Misma filosofía (el filesystem es el
manifest, cero campos vacíos, colores por CSS vars, motor mustache-subset), pero
distinto medio: la web NO es self-contained (vive en internet, luego migra al
server del cliente), así que Tailwind CDN + iconify + Google Fonts SÍ están
permitidos. La única restricción dura de recursos externos es: **cero fotos de
personas/lugares que no sean del negocio real**.

---

## 1. Propósito y alcance

- Cada archivo es una **página web completa por rubro**, hoy en
  `src/templates/doctor/` (después vendrán otros rubros con su propia carpeta).
- **El pool se arma por GLOB**: todo `*.html` de la carpeta que NO empiece con `_`
  es una plantilla activa del pool. El filesystem es el manifest — igual que
  `src/dc-templates/`. Sumar una plantilla = tirar el archivo; sacarla = borrarlo.
  No se edita una lista curada.
- **Prefijo `_` reservado**: `_viewer.html` (el visor swipeable) y
  `_BRIEF-web-doctor.md` (este doc) NO son plantillas. Cualquier archivo auxiliar
  futuro que no deba entrar al pool lleva prefijo `_`.
- `build-web` rellena CADA plantilla del glob con un ÚNICO objeto `view`
  (el mismo para todas), escribe `leads/<slug>/web/<archivo>.html`, y arma un
  visor swipeable en `leads/<slug>/web/index.html` para que el cliente elija
  diseño. Mismo patrón que build-cards.
- **Cada plantilla conserva su identidad visual completa**: sus secciones únicas,
  animaciones, efectos, tipografías y layout. NO se homogeneízan. Se re-parametriza
  para que se llene con datos reales, pero el diseño sigue siendo el que era.
- **Cada plantilla usa SOLO los placeholders que su diseño necesita.** El registro
  (§3) es la UNIÓN de todo lo disponible; ninguna plantilla usa todo. Un dato que
  la plantilla no muestra, simplemente no se referencia — no hay penalización por
  no usar un campo.

Regla de oro heredada de las digital cards: **ningún campo se muestra vacío.**
Todo dato opcional va envuelto en su guard `{{#tiene_x}}...{{/tiene_x}}`. Si el
lead no lo trae, la sección no renderiza. Prohibido dejar un `{{campo}}` suelto
que pueda salir vacío.

---

## 2. Sintaxis del motor (`src/lib/template.ts`)

Subconjunto tipo mustache, propio, puro y determinista. Solo existe esto:

| Sintaxis | Qué hace |
|---|---|
| `{{clave}}` | Interpola **escapando** HTML. Para todo texto visible. |
| `{{{clave}}}` o `{{&clave}}` | Interpola **crudo** (sin escapar). |
| `{{obj.prop}}` | Acceso por punto (ej. `{{colors.primary}}`). |
| `{{#seccion}}...{{/seccion}}` | Sección: si el valor es **array → repite** el bloque por item; si es **truthy → lo muestra una vez** empujando el objeto al contexto; si es **objeto → empuja el objeto** al contexto. |
| `{{^seccion}}...{{/seccion}}` | Sección **invertida**: renderiza si el valor es falsy o array vacío. |
| `{{.}}` | El item actual, dentro de una sección sobre un array de strings. |

No hay `if/else`, ni helpers, ni lógica, ni condicionales con operadores. Solo
esto.

### GOTCHAS OBLIGATORIOS (violar esto rompe el render en silencio)

**(a) Claves ASCII-only. Sin tildes ni ñ. INNEGOCIABLE.**
El regex del motor (`template.ts` línea ~22) matchea nombres de token con `[\w.]`,
que en JS es `[A-Za-z0-9_.]` — **NO incluye tildes ni ñ**. Consecuencia crítica:
una clave con tilde/ñ **no lanza error**; simplemente **no se reconoce como token**
y queda escrita como TEXTO LITERAL en el HTML final (`{{misión}}` aparece tal cual
en la página del cliente). Es el bug más silencioso posible.

Por eso TODAS las claves son ASCII. Ejemplos canónicos del registro:
`anio` (no "año"), `mision` (no "misión"), `educacion` (no "educación"),
`resenas` (no "reseñas"), `calificacion`, `direccion`, `credenciales`. El TEXTO de
los valores sí puede tener tildes/ñ (los valores son datos, no nombres de token) —
lo que debe ser ASCII es la CLAVE.

**(b) Sombra de contexto dentro de secciones.**
Dentro de `{{#objeto}}...{{/objeto}}` o `{{#array}}...{{/array}}`, las claves del
item **sombrean** las globales del mismo nombre. Si un item de `servicios[]` tiene
`nombre`, dentro de `{{#servicios}}` la clave `{{nombre}}` es la del servicio, NO
el `{{nombre}}` global de la persona/negocio. El motor resuelve de adentro hacia
afuera. Elegí nombres de sub-claves que no choquen con globales que necesites en
el mismo bloque, o sacá el valor global a una variable antes de entrar a la
sección.

**(c) Para envolver una sección de array con markup (título, header de sección),
usar el flag booleano `tiene_x` como guard EXTERNO.**
El motor no ofrece "renderiza este encabezado solo si el array no está vacío"
dentro del propio `{{#array}}` (repetiría el encabezado por item). Patrón correcto:

```html
{{#tiene_servicios}}
  <section id="services">
    <h2>Servicios</h2>
    <div class="grid">
      {{#servicios}}
        <article><h3>{{nombre}}</h3>{{#tiene_descripcion}}<p>{{descripcion}}</p>{{/tiene_descripcion}}</article>
      {{/servicios}}
    </div>
  </section>
{{/tiene_servicios}}
```

El guard externo `tiene_servicios` decide si aparece TODA la sección (con su
título); el `{{#servicios}}` interno solo itera las tarjetas.

**(d) La interpolación cruda `{{{...}}}` es SOLO para dos cosas:** los hex de color
del bloque de marca (§4) y `{{{mapa_embed_url}}}` (URL del iframe de Google Maps).
**Todo lo demás va escapado** (`{{...}}` doble llave). Nunca metas texto generado
por el LLM ni datos del lead en crudo — se escapan siempre para evitar inyección y
roturas de layout.

---

## 3. Registro UNIÓN de placeholders

Este es el catálogo completo. Está partido en: (3a) universales que cualquier
plantilla puede usar, (3b) únicos de sección que solo algunas usan, (3c) slots de
imagen, y (3d) la matriz de qué usa cada plantilla.

Convención de tipos:
- `bool` → usar como guard `{{#tiene_x}}`.
- `string` marcado "opcional" → SIEMPRE guardado por su `tiene_x`.
- `array[]` → recorrer con `{{#clave}}...{{/clave}}`; envolver con `tiene_clave`.
- `objeto` → `{{#clave}}` empuja sus props al contexto.

### 3a. Universales (cualquier plantilla puede usarlos)

**Identidad**
| Clave | Tipo | Significado |
|---|---|---|
| `nombre` | string | Nombre a mostrar: persona › negocio › slug. **Nunca vacío.** Es el h1 de la mayoría de los diseños. |
| `inicial` | string | Una letra mayúscula, para avatar placeholder cuando no hay foto/logo. |
| `tagline` / `tiene_tagline` | string / bool | Lema / especialidad ("Odontología integral"). Opcional. |

**Meta**
| Clave | Tipo | Significado |
|---|---|---|
| `meta_titulo` | string | Para `<title>`. Nunca vacío (cae a `nombre — tagline` o `nombre`). |
| `meta_descripcion` | string | Para `<meta name="description">`. Nunca vacío. |

**Hero (copy de marketing, generado por `enrich`)**
| Clave | Tipo | Significado |
|---|---|---|
| `hero_badge` / `tiene_hero_badge` | string / bool | Píldora de estado ("Aceptando pacientes"). Opcional. |
| `hero_titulo` | string | Titular del hero. Nunca vacío (fallback a tagline/nombre). |
| `hero_subtitulo` / `tiene_hero_subtitulo` | string / bool | Bajada del hero. Opcional. |
| `hero_cta` | string | Texto del botón principal del hero ("Agendar consulta"). |

**Cuerpo / sobre**
| Clave | Tipo | Significado |
|---|---|---|
| `bio` / `tiene_bio` | string / bool | Texto libre "sobre el profesional/negocio". Opcional. |
| `cita_destacada` / `tiene_cita_destacada` | string / bool | Frase destacada tipo pull-quote. Opcional. |

**Contacto (datos REALES del lead — nunca del LLM)**
| Clave | Tipo | Significado |
|---|---|---|
| `telefono` / `telefono_href` / `tiene_telefono` | string / string / bool | `telefono` para mostrar; `telefono_href` listo para `href="tel:..."` (solo dígitos y `+`). |
| `whatsapp_url` / `tiene_whatsapp` | string / bool | URL `wa.me` con mensaje precargado. El CTA que más convierte. Link externo. |
| `email` / `tiene_email` | string / bool | Correo. Usar en `href="mailto:{{email}}"`. |
| `direccion` / `tiene_direccion` | string / bool | Dirección en una línea. |
| `mapa_url` | string | Link a Google Maps (abrir en pestaña nueva). Va junto a `direccion`. |
| `{{{mapa_embed_url}}}` | string (CRUDO) | URL para el `src` de un `<iframe>` de mapa embebido. Es de los DOS únicos campos crudos (§2d). Guardar con `tiene_direccion`. |

**Horario**
| Clave | Tipo | Significado |
|---|---|---|
| `horario_lineas[]` | string[] | Líneas del horario ("Lun a Vie 9–18"). Recorrer con `{{#horario_lineas}}{{.}}{{/horario_lineas}}`. |
| `tiene_horario` | bool | Guard del bloque de horario. |
| `horario_referencial` | bool | El horario es un DEFAULT por rubro, no confirmado por el humano. Si es true, marcar el bloque con una nota discreta ("Horario referencial"). |

**Redes (links externos)**
| Clave | Tipo | Significado |
|---|---|---|
| `instagram_url` / `tiene_instagram` | string / bool | |
| `facebook_url` / `tiene_facebook` | string / bool | |
| `tiktok_url` / `tiene_tiktok` | string / bool | |
| `tiene_redes` | bool | true si hay al menos una red. Guard del bloque social. |

**Credenciales y servicios**
| Clave | Tipo | Significado |
|---|---|---|
| `credenciales[]` `{clave, valor}` / `tiene_credenciales` | array / bool | Pares legibles ("Cédula profesional": "1234567"). |
| `servicios[]` `{n, nombre, descripcion, tiene_descripcion}` / `tiene_servicios` | array / bool | `n` = "01","02"… (numeración). `descripcion` puede faltar → guardar con `tiene_descripcion` del item. |
| `propuestas[]` `{titulo, descripcion}` / `tiene_propuestas` | array / bool | Propuestas de valor / diferenciales. |

**CTA final y footer**
| Clave | Tipo | Significado |
|---|---|---|
| `cta_titulo` | string | Titular de la sección CTA final. Nunca vacío. |
| `cta_subtexto` / `tiene_cta_subtexto` | string / bool | Bajada del CTA. Opcional. |
| `footer_bio` | string | Línea breve del footer (cae a tagline). |
| `anio` | number | Año actual, para el copyright. **`anio`, NO `año`** (§2a). |

**Tema (colores medidos + guards; en inglés, siguiendo el patrón dc)**
| Clave | Tipo | Significado |
|---|---|---|
| `colors.primary` / `colors.secondary` / `colors.accent` | string hex | Colores de marca medidos de la tarjeta real. |
| `colorsText.primary` / `colorsText.secondary` / `colorsText.accent` | string hex | `#ffffff` o `#000000`: texto legible (WCAG) SOBRE el color de marca del mismo rol. |
| `colors.background` / `hasBackground` | string hex / bool | Fondo medido opcional. Usar SOLO dentro de `:root[data-brand]` bajo `{{#hasBackground}}`. |
| `colors.surface` / `hasSurface` | string hex / bool | Superficie medida opcional. Igual, bajo `{{#hasSurface}}`. |

> Las claves de tema quedan en **inglés** (`colors`, `colorsText`, `hasBackground`,
> `hasSurface`) a propósito: replican EXACTO el patrón de `src/dc-templates/` para
> que build-web y build-cards compartan la forma del objeto de tema. Son la única
> isla en inglés del registro y **solo** aparecen dentro del bloque de estilo de
> marca (§4).

### 3b. Únicos de sección (contenido demo generado por LLM; TODOS con guard `tiene_*`)

Estos campos alimentan las secciones características de cada plantilla. Salen del
copy generado por `enrich` (contenido de MUESTRA salvo donde se indique). Como
son de muestra, la página lleva un aviso demo global (§6). TODOS van bajo su guard.

| Placeholder / guard | Item / tipo | Notas |
|---|---|---|
| `stats[]` / `tiene_stats` | `{valor, etiqueta}` | Métricas de confianza ("12k+", "Pacientes"). **Máx 4.** |
| `nuestro_equipo[]` / `tiene_nuestro_equipo` | `{nombre, rol, img, destacado}` | **5** miembros. `img` ya viene resuelto a `assets/...` (§3c). `destacado` bool → card central resaltada. |
| `experiencia[]` / `tiene_experiencia` | `{puesto, lugar, periodo, descripcion, actual}` | Timeline de CV. `actual` bool → marca "presente". |
| `educacion[]` / `tiene_educacion` | `{titulo, institucion, periodo, detalles[]}` | `detalles[]` es array de strings. Clave `educacion`, no "educación". |
| `investigacion[]` / `tiene_investigacion` | `{etiqueta, titulo, descripcion}` | Publicaciones / research. |
| `habilidades[]` / `tiene_habilidades` | string | Chips. Recorrer con `{{.}}`. |
| `idiomas[]` / `tiene_idiomas` | `{idioma, nivel}` | |
| `mision` / `tiene_mision` | string | Declaración de misión. Clave `mision`, no "misión". |
| `educacion_paciente[]` / `tiene_educacion_paciente` | `{titulo, descripcion}` | Consejos / educación al paciente. |
| `sedacion` / `tiene_sedacion` | `{titulo, descripcion, puntos[]}` | **Objeto** (no array). `puntos[]` array de strings. |
| `higiene_puntos[]` / `tiene_higiene_puntos` | `{titulo, descripcion}` | Protocolo de higiene / bioseguridad. |
| `doctor_cita` / `tiene_doctor_cita` | `{nombre, rol}` | **Del LEAD real, no demo.** Firma de la cita del doctor. |
| `testimonios[]` / `tiene_testimonios` | `{cita, autor, rol, tiene_rol}` | Reseñas. `rol` opcional por item. Ver `testimonios_son_ejemplo`. |
| `testimonios_son_ejemplo` | bool | true → los testimonios son de muestra. NO poner badge "Ejemplo" por tarjeta: el aviso demo global (§6) lo cubre. |
| `faq[]` / `tiene_faq` | `{pregunta, respuesta}` | **Máx 9.** |
| `cta_urgencia` / `tiene_cta_urgencia` | `{titulo, subtexto}` | Banda de urgencias/disponibilidad inmediata. |
| `badge_disponibilidad` / `tiene_badge_disponibilidad` | string | Píldora de disponibilidad ("Disponible hoy"). |
| `calificacion` / `tiene_calificacion` | `{valor, resenas}` | `valor` ("4.9"), `resenas` (cantidad). Clave `resenas`, no "reseñas". |
| `confianza_items[]` / `tiene_confianza_items` | string | Ítems de confianza ("Especialistas certificados"). Recorrer con `{{.}}`. |
| `responsable_tecnico` / `tiene_responsable_tecnico` | string | Nombre del responsable técnico/sanitario. **Derivado del lead**, no demo. |
| `demo_es_ejemplo` | bool | Enciende el aviso demo global (§6). |

### 3c. Slots de imagen (claves planas)

Cada slot es una clave plana que build-web resuelve a una ruta
`assets/<Tag>.webp` **relativa a `web/`** (la página vive en
`leads/<slug>/web/index.html`, y las imágenes en `leads/<slug>/web/assets/`).
El template las usa directo en `src`, sin `../`:

```html
<img src="{{img_retrato_principal}}" alt="{{nombre}}">
```

| Slot | Uso |
|---|---|
| `img_retrato_principal` | Retrato principal, elegido según el género del lead. **Si el lead tiene foto real (`brand.photo_path`), build-web la pone acá** — el template NO distingue foto real vs retrato genérico, siempre usa esta clave. |
| `img_hero_01`, `img_hero_02` | Imágenes del hero. |
| `img_consultorio_01`, `img_consultorio_02` | Fotos de consultorio / instalaciones. |
| `img_equipo_01` | Foto del equipo. |
| `img_sonrisa_01` | Primer plano tipo "resultado" (sonrisa/rostro). |
| `img_recepcion_01` | Recepción / sala de espera. |
| `img_avatar_01`, `img_avatar_02`, `img_avatar_03` | Avatares chicos (testimonios, equipo reducido). |

Reglas de imágenes:
- Un template **sin fotos** (ej. `doc-lujo`) simplemente **no usa ningún slot**.
  No hay obligación de mostrar imágenes.
- Los slots que un template usa deben ir siempre asociados a su dato: si un slot
  no está resuelto, build-web lo resuelve a un asset por defecto del kind — pero
  el template no debe asumir una imagen concreta.
- **NUNCA URLs externas de imágenes.** Prohibido `images.unsplash.com`,
  `*.supabase.co`, cualquier CDN, `transparenttextures.com`. Toda imagen sale de
  un slot `img_*` (que build-web resuelve a `assets/` local). Ver el checklist de
  scrubbing (§5).

### 3d. Matriz de consumo template × campo (los 7 del pool doctor)

Marca qué campos ÚNICOS (§3b) usa cada plantilla, además de los universales (§3a)
que todas comparten. Sirve para que cada agente sepa exactamente qué secciones
parametrizar en SU plantilla y no toque las de otras.

| Campo único | clasico | perfil | lujo | moderno | limpio | familiar | urgencias |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `stats[]` | ✅ (1º) | | | | ✅ (4) | | ✅ (1º) |
| `confianza_items[]` | ✅ | | | | ✅ | | |
| `experiencia[]` | | ✅ | | | | | |
| `educacion[]` | | ✅ | | | | | |
| `investigacion[]` | | ✅ | | | | | |
| `habilidades[]` | | ✅ | | | | | |
| `idiomas[]` | | ✅ | | | | | |
| `badge_disponibilidad` | | ✅ | | | | | ✅ |
| `higiene_puntos[]` | | | ✅ | | | | |
| `doctor_cita` | | | ✅ | | | | |
| `testimonios[]` | | | ✅ (4) | | | | ✅ (2) |
| `calificacion` | | | ✅ | | ✅ | | ✅ |
| `sedacion` | | | | ✅ | | | |
| `nuestro_equipo[]` | | | | | ✅ (5) | | |
| `faq[]` | | | | | ✅ (5) | ✅ (4) | ✅ (hasta 9) |
| `mision` | | | | | | ✅ | |
| `educacion_paciente[]` | | | | | | ✅ | |
| `servicios_quick_links` | | | | | | ✅ (← `servicios`) | |
| `cta_urgencia` | | | | | | | ✅ |
| `responsable_tecnico` | | | | | | | ✅ |

Notas de la matriz:
- **"(1º)" / "(4)" / "(5)" / "(2)"** = cantidad esperada de items que ese diseño
  muestra (ej. `clasico` usa solo el 1er stat como card flotante; `limpio` usa 4;
  `lujo` muestra 4 testimonios, `urgencias` solo 2). No es un límite del motor,
  es lo que el layout de ese diseño espera.
- **`servicios_quick_links`** (`familiar`): NO es un campo nuevo. Es el MISMO
  `servicios[]` de §3a, renderizado como accesos rápidos. Reusa `{{#servicios}}`.
- Los 7 nombres canónicos de archivo son: `doc-clasico.html`, `doc-perfil.html`,
  `doc-lujo.html`, `doc-moderno.html`, `doc-limpio.html`, `doc-familiar.html`,
  `doc-urgencias.html`.

---

## 4. Doble paleta (patrón dc — snippet exacto)

Toda plantilla trae DOS paletas: la ORIGINAL del diseño (identidad por defecto) y
la de MARCA del lead (se activa cuando el visor manda el toggle "Ver con los
colores de tu marca"). Es idéntico al patrón de `src/dc-templates/executive.html`.

**Paso 1 — `:root` con la paleta ORIGINAL hardcodeada.** Son los colores propios
del diseño; es lo que se ve por defecto (toggle OFF):

```css
:root{
  /* Paleta ORIGINAL del diseno (default, toggle OFF). Hardcodeada. */
  --primary:#0F4C5C;
  --secondary:#C9A24D;
  --accent:#8b94a3;
  --on-primary:#ffffff;
  --on-secondary:#1a1a1a;
  --on-accent:#ffffff;
  /* ...resto de tokens neutros propios del diseno... */
}
```

**Paso 2 — `:root[data-brand]` con la paleta de MARCA inyectada.** Estos son los
únicos hex crudos (`{{{...}}}`). Cuando el `<html>` tiene `data-brand`, ganan sobre
los de arriba:

```css
:root[data-brand]{
  --primary:{{{colors.primary}}};
  --secondary:{{{colors.secondary}}};
  --accent:{{{colors.accent}}};
  --on-primary:{{{colorsText.primary}}};
  --on-secondary:{{{colorsText.secondary}}};
  --on-accent:{{{colorsText.accent}}};
  {{#hasBackground}}--card-bg:{{{colors.background}}};{{/hasBackground}}
  {{#hasSurface}}--card-surface:{{{colors.surface}}};{{/hasSurface}}
}
```

**Paso 3 — Tailwind CDN mapeado a las vars.** Después del `<script src="...cdn.tailwindcss.com">`,
un `<script>` inline que apunta los colores de marca de Tailwind a las CSS vars:

```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: { extend: { colors: {
      primary:   'var(--primary)',
      secondary: 'var(--secondary)',
      accent:    'var(--accent)',
    } } }
  };
</script>
```

**Paso 4 — Reemplazar SOLO las clases portadoras de marca.** En el diseño original,
cambiar únicamente las clases que llevan el color de marca:
- `text-[#0F4C5C]` → `text-primary`
- `bg-emerald-600` / `bg-[#0F4C5C]` → `bg-primary`
- `border-[#C9A24D]` → `border-secondary`, etc.

Los **neutros se dejan FIJOS** (`slate-*`, `gray-*`, `white`, `black`): son la
estructura del diseño y garantizan contraste. Si los mapeás a marca, una paleta
oscura del lead puede romper la legibilidad. Sobre superficies de marca
(`bg-primary`, etc.), el texto usa la var de contraste correspondiente
(`--on-primary` / `--on-secondary` / `--on-accent`), nunca blanco/negro hardcodeado.

**Paso 5 — NO tocar el toggle.** El script que pone/saca `data-brand` en `<html>`
(en respuesta al `postMessage` del visor) lo **inyecta build-web**
(`injectBrandToggle`) al escribir la página. El template **NO** escribe ese script
y **NO** registra listeners `message` propios (chocarían con el del toggle — ver
§8). La plantilla solo declara las dos paletas; el switch es del pipeline.

---

## 5. Checklist de scrubbing (datos reales de terceros — PROHIBIDO que sobrevivan)

Las plantillas vienen de mockups reales de otros negocios (aura.build, Thryv,
editores varios). Todo rastro de datos/recursos de terceros debe ELIMINARSE o
reemplazarse por placeholders del registro. Buscá y matá TODO esto:

**Tracking / analytics (eliminar el bloque entero):**
- Google Analytics / gtag: `G-2M6V79H761`, cualquier `googletagmanager.com/gtag`,
  `dataLayer`, `function gtag(){...}`. (Aparece hardcodeado en `doc-lujo`.)
- `promotekit`, cualquier pixel o beacon.

**Controladores / preloaders de editores (eliminar):**
- `aura-preview-performance-controller` (redefine `setInterval`), el bridge
  `message` de aura.build, `FxFilter.js`, cualquier script de preview/preloader.
- `meta[name="disabled-font-classes"]` y los `<link>/<style>` de fuentes que el
  editor dejó pero el diseño no usa (aparecen en `doc-perfil`).

**Datos de contacto reales de terceros (reemplazar por placeholders §3a):**
- Emails: `laibashoukat9180@gmail.com` y cualquier email real.
- Teléfonos: `+92…`, `+880…`, `732-968-8585`, `064 504 3509`, `+55…` y cualquiera.
- Direcciones/ciudades: Islamabad, Dhaka, Pretoria, Green Brook NJ, Belo Horizonte,
  New Delhi, Los Ángeles, y cualquier ubicación real.
- Registros profesionales reales: CRO, MG, cédulas de otras personas.
- Instituciones / publicaciones reales: `msrajournalreview` y similares.
- Links a redes sociales reales (perfiles concretos de terceros).

**Recursos externos de imagen (eliminar; usar slots `img_*` §3c):**
- `images.unsplash.com`, `*.supabase.co`, `cdn.website.thryv.com`,
  `lirp.cdn-website.com`, `transparenttextures.com`, `aura.build`, cualquier CDN.
- `<iframe>` de Google Maps con coordenadas/lugar hardcodeado → usar
  `{{{mapa_embed_url}}}`.

**Convención vieja de placeholder:**
- `[Nombre]`, `[NOMBRE]`, `Clínica [Nombre]`, `Dr. [Nombre]`, `Dra. [Nombre]` →
  reemplazar por los placeholders del registro (`{{nombre}}`, etc.). **Cero
  corchetes `[...]` deben sobrevivir.**

Regla mental: si un dato identifica a un negocio/persona que NO es el lead, o
carga un recurso de un dominio de terceros, se va.

---

## 6. Aviso demo (decisión de producto)

Buena parte del contenido (stats, testimonios, faq, misión, etc.) es de MUESTRA
generado por LLM. El cliente tiene que entender que es un ejemplo, sin que la
página parezca a medio hacer.

- **UN solo aviso discreto, global por página.** Un banner fino arriba, o una
  línea en el footer: **"Página de demostración — contenido de muestra"**.
- Va envuelto en `{{#demo_es_ejemplo}}...{{/demo_es_ejemplo}}`.
- **NO** badges "Ejemplo" por sección ni por tarjeta. El aviso global cubre todo.
- El viejo tag "Ejemplo" que traían los testimonios se **elimina** en favor de
  este aviso. (`testimonios_son_ejemplo` sigue existiendo por si un diseño quiere
  atenuar visualmente esa sección, pero NO agrega un badge propio.)

---

## 7. Validación de íconos iconify

Los diseños usan iconify (`<span class="iconify" data-icon="...">` o
`<iconify-icon icon="...">`). **Todo nombre de ícono debe validarse ANTES de
usarlo**, porque un ícono inexistente se renderiza como un hueco vacío (falla
silenciosa).

Validación por API (agrupar por prefijo):
```
https://api.iconify.design/{prefix}.json?icons=nombre1,nombre2,nombre3
```
Si un nombre aparece en el array `not_found` de la respuesta, **no existe** —
elegí otro.

Bug real previo (íconos usados por error que NO existen):
`solar:tooth-linear`, `solar:quote-up-linear`, `solar:instagram-linear`,
`solar:facebook-linear`. No asumas que un nombre "razonable" existe; validalo.

Los íconos **lucide como SVG inline** (pegados en el HTML, no vía red) no
requieren validación por API — ya están en el archivo.

---

## 8. Prohibiciones (romper esto rompe el visor o la confianza del cliente)

- **`alert` / `confirm` / `prompt`** ni ningún diálogo modal del navegador
  (bloquean el visor swipeable).
- **Listeners `window.addEventListener('message', ...)` propios.** El toggle de
  marca usa `postMessage`; un listener propio choca. El único manejo de `message`
  lo inyecta build-web.
- **Tracking / analytics** de cualquier tipo (gtag, pixels, beacons).
- **Dependencias JS externas nuevas.** Permitido SOLO: Tailwind CDN, iconify, y
  Google Fonts que el diseño YA usa. Quitá los `<link>` de fuentes que el diseño
  no usa. Nada de librerías nuevas.
- **Texto hardcodeado que debería ser placeholder** (nombres, teléfonos, servicios,
  copy) — todo dato variable sale del registro.
- **Inventar datos de contacto** (teléfonos, emails, direcciones, registros). Si el
  lead no lo trae, la sección no aparece (su guard `tiene_x` es false). Nunca
  rellenar con datos plausibles.
- **URLs externas de imágenes** (ver §3c y §5). Solo slots `img_*`.
- **Corchetes `[Nombre]`** u otra convención vieja sobreviviente.

---

## 9. Alta y baja de plantillas (proceso)

### Alta de una plantilla nueva

1. Crear `src/templates/doctor/<nombre>.html` cumpliendo TODO este brief
   (kebab-case, sin prefijo `_`). Con solo estar en la carpeta, el GLOB la suma
   al pool — no se toca código para registrarla.
2. **(Opcional)** Etiqueta legible + público objetivo en `WEB_LABELS`
   (`src/config/rubro-map.ts`), con la clave = nombre de archivo sin extensión:
   ```ts
   "doc-nocturno": { name: "Nocturno", audience: "Guardias y urgencias" },
   ```
   Sin entrada, el chip del visor cae al fallback (nombre de archivo capitalizado,
   sin público objetivo). (`WEB_LABELS` es el equivalente web de `CARD_LABELS`.)
3. **Si necesita un campo NUEVO** (que no está en §3), sumarlo en los CUATRO
   lugares, en orden:
   1. Este registro (§3a o §3b) — la fuente de verdad.
   2. El schema del contenido demo (`src/lib/schema.ts`).
   3. El prompt de enrich (`src/prompts/write-copy.md`) para que el LLM lo genere.
   4. El view builder (`buildWebView` en `src/stages/build-web.ts`) para que llegue
      al template, con su guard `tiene_x`.
   Las demás plantillas **no se tocan**: como todo va con guards `tiene_*`, un
   campo nuevo que no usan simplemente no renderiza en ellas.
4. **Si necesita un kind de imagen nuevo** (un slot `img_*` que no existe),
   sumarlo a `assets/manifest.json` (el manifest de kinds de imagen web).
5. Correr `pnpm test` (la suite de invariantes aplica sola a TODO el glob:
   render sin `{{` residual, secciones bien cerradas, cero datos del scrubbing) +
   QA en browser.

### Baja de una plantilla

1. Borrar el archivo `src/templates/doctor/<nombre>.html`. El glob y el visor se
   ajustan solos.
2. Quitar su entrada de `WEB_LABELS` (si tenía).
3. Quitar cualquier `describe` específico de esa plantilla en los tests (si existía
   uno dedicado; los tests de invariantes del glob no necesitan cambios).

---

## 10. Checklist final por template (para el agente que parametriza)

Antes de dar por terminada una plantilla, verificar TODO:

- [ ] **Cero `[Nombre]`** ni corchetes de placeholder viejo.
- [ ] **Cero datos del checklist §5** (gtag `G-2M6V79H761`, emails/teléfonos/
      direcciones reales, registros, instituciones, CDNs de imagen, iframes de
      maps hardcodeados, controladores de editor).
- [ ] **Doble paleta presente**: `:root` original + `:root[data-brand]` con los
      `{{{colors.*}}}` / `{{{colorsText.*}}}` + guards `hasBackground`/`hasSurface`,
      y el `tailwind.config` inline mapeado a las vars.
- [ ] **Aviso demo presente** bajo `{{#demo_es_ejemplo}}` (uno solo, global).
- [ ] **Íconos validados** por la API de iconify (cero `not_found`).
- [ ] **Imágenes solo por slots `img_*`** (cero URLs externas de imagen).
- [ ] **Animaciones y secciones originales intactas** — la identidad visual del
      diseño se conserva.
- [ ] **Claves ASCII** en todos los tokens (`anio`, `mision`, `educacion`,
      `resenas`, …); ninguna con tilde/ñ.
- [ ] **Todo dato opcional guardado** con su `{{#tiene_x}}`; ningún `{{campo}}`
      suelto que pueda salir vacío.
- [ ] **`{{{...}}}` crudo SOLO** en los hex de color y en `mapa_embed_url`; todo lo
      demás escapado.
- [ ] **Sin `alert`/`confirm`/`prompt`, sin listeners `message` propios, sin
      analytics, sin JS externo nuevo.**
- [ ] **Links externos** (whatsapp, mapa, redes) con `target="_blank" rel="noopener"`.
- [ ] **Render de prueba limpio**: pasar la plantilla por el view de prueba y
      confirmar que **no queda ningún `{{` en el HTML final**. (`pnpm typecheck`
      no aplica a HTML; la validación es el render + la suite de invariantes.)
```

# Brief para diseñar una digital card nueva (pool `src/dc-templates/`)

Este documento es el paquete completo que se le entrega a un agente de diseño
(o a un humano) para generar un diseño nuevo del pool de digital cards. No hace
falta leer el resto del repo: acá está todo el contrato.

## Qué es una digital card

Un **único archivo `.html` standalone**. El pipeline (`build-cards`) lo rellena
con los datos reales de un negocio y lo escribe en `leads/<slug>/dc/<nombre>.html`.
El visor swipeable (`_viewer.html`) carga cada diseño dentro de un `<iframe>` a
pantalla completa. El cliente hace swipe entre los diseños y elige el que le gusta.

El origen del negocio es una foto de una tarjeta de presentación (doctor,
barbería, estética, veterinario, nutriólogo, "otro"). El diseño tiene que verse
premium: limpio, elegante, confiable. Es una propuesta comercial, no una demo.

## Reglas duras (no negociables)

1. **Un solo archivo `.html`.** Nombre en kebab-case, sin prefijo `_` (ese
   prefijo queda reservado para el visor). Se tira en `src/dc-templates/` y el
   stage lo detecta solo — no se toca código para sumarlo al pool.
2. **Self-contained.** Todo el CSS y JS va inline en el propio archivo. Nada de
   `<link>` a hojas de estilo externas, nada de `<script src>` externo, nada de
   `fetch`/imágenes remotas. Íconos → SVG inline. Imágenes → data URI.
   - **Única excepción permitida: Google Fonts** vía `<link>` en el `<head>`.
     Es la excepción explícita del proyecto para preservar identidad tipográfica.
     Elegir 1–2 familias con carácter y cargarlas con `&display=swap`.
3. **Mobile-first, dentro de un iframe a `100%` de ancho y alto.** El diseño
   ocupa toda la pantalla del teléfono. Usar `min-height:100dvh`, `clamp()` para
   tipografías fluidas, y un `max-width` centrado (~440px) para que en desktop no
   se estire feo. Referencia de breakpoints: ver `executive.html`.
4. **JS opcional y mínimo.** Los diseños actuales son estáticos (el swipe lo
   maneja el visor, no la card). Si se agrega JS, va inline y **NUNCA** puede
   disparar `alert`/`confirm`/`prompt` ni diálogos modales (bloquean el visor).
5. **Ningún campo se muestra vacío.** Cada dato opcional va envuelto en su
   sección `{{#hasX}}...{{/hasX}}`. Si el lead no lo trae, la sección no
   renderiza. Prohibido dejar un `{{campo}}` suelto que pueda salir vacío o como
   texto crudo.
6. **Colores dinámicos por CSS vars.** Los hex de marca llegan como variables de
   template y se inyectan en `:root`. Ver sección "Tema".
7. **Links que salen de la página** llevan `target="_blank" rel="noopener"`.
8. **Idioma del contenido visible: español neutro.** Sin voseo.

## Motor de templates (sintaxis)

Subconjunto tipo mustache, propio (`src/lib/template.ts`). Solo esto:

| Sintaxis | Qué hace |
|---|---|
| `{{clave}}` | Interpola **escapando** HTML. Para texto visible. |
| `{{{clave}}}` o `{{&clave}}` | Interpola **crudo** (sin escapar). Para hex de color, JSON-LD, SVG. |
| `{{objeto.prop}}` | Acceso por punto (ej. `{{colors.primary}}`). |
| `{{#clave}}...{{/clave}}` | Sección: si es array **repite** el bloque por item; si es truthy lo muestra una vez. |
| `{{^clave}}...{{/clave}}` | Sección invertida: renderiza si es falsy o array vacío. |
| `{{.}}` | El item actual, dentro de una sección sobre un array de strings. |

No hay `if/else`, ni helpers, ni lógica. Solo esto. Dentro de un `{{#objeto}}`
el contexto se abre: podés usar sus props directo (`{{key}}`, `{{value}}`).

## Contrato de datos (el objeto `view` completo)

Todo lo que sigue está SIEMPRE disponible en el template. `bool` = usar como
sección `{{#x}}`. Un `string` marcado "puede ser vacío" **debe** ir guardado por
su `hasX`.

### Identidad
| Campo | Tipo | Significado |
|---|---|---|
| `slug` | string | Clave del lead (kebab-case). |
| `name` | string | Nombre del negocio (cae al slug si falta). Nunca vacío. |
| `personName` | string | Nombre de la persona. Puede ser vacío. |
| `tagline` | string | Lema / especialidad. Puede ser vacío → guardar con `{{#tagline}}`. |
| `heroName` | string | Persona › negocio › slug. **Nunca vacío.** Es el h1 en los diseños "persona primero". |
| `orgName` | string | Nombre del negocio (para la línea de organización). Puede ser vacío. |
| `hasOrgLine` | bool | true si `orgName` existe y difiere de `heroName`. Guardar la línea de org con esto. |
| `logoPath` | string | Ruta al logo real si existe (`{{#logoPath}}<img>{{/logoPath}}`). Nunca generar caras/fotos falsas. |
| `initial` | string | Una letra mayúscula, para avatar placeholder (cuando no hay logo). |
| `fontFamily` | string | Stack web-safe derivado del `font_hint`. Solo lo usa `credencial`; los demás traen su propia Google Font. |

### Contacto (campos planos — el patrón de los diseños nuevos)
| Campo | Tipo | Significado |
|---|---|---|
| `hasPhone` | bool | Hay teléfono principal. |
| `phoneDisplay` | string | Teléfono para mostrar. |
| `phoneTelHref` | string | `tel:...` listo para el `href`. |
| `whatsappUrl` | string | URL `wa.me` con mensaje precargado (o vacío). CTA que más convierte. Suele guardarse bajo `{{#hasPhone}}`. |
| `hasEmail` | bool | / `email` (string). |
| `hasWebsite` | bool | / `website` (string, URL). El sitio PROPIO del negocio (ya lo tenía antes de la tarjeta). |
| `hasGeneratedWeb` | bool | / `generatedWebUrl` (string, ruta relativa). La mini-web que GENERAMOS (`build-web`), carpeta hermana `web/`. No confundir con `hasWebsite` — pueden aparecer los dos juntos. Gateado por status (`web_built` o posterior): mientras no exista no se muestra, para no linkear a un 404. |
| `hasAddressLine` | bool | / `addressLine` (string, dirección en una línea) / `mapsUrl` (string, link a Google Maps). |
| `hasSocials` | bool | Hay al menos una red. |
| `hasInstagram` | bool | / `instagramUrl` (string). |
| `hasFacebook` | bool | / `facebookUrl` (string). |
| `hasTiktok` | bool | / `tiktokUrl` (string). |

### Servicios y atributos
| Campo | Tipo | Significado |
|---|---|---|
| `hasServices` | bool | Hay servicios. |
| `services` | string[] | Lista simple de servicios. Recorrer con `{{#services}}{{.}}{{/services}}`. |
| `servicesNumbered` | array `{n, name}` | Igual pero numerado (`n` = "01","02"…). Recorrer con `{{#servicesNumbered}}{{n}} {{name}}{{/servicesNumbered}}`. |
| `hasAttrs` | bool | Hay atributos libres (varían por rubro: "Cédula", "Horario", etc.). |
| `attrs` | array `{key, value}` | Pares clave/valor. `{{#attrs}}{{key}}: {{value}}{{/attrs}}`. |

### Tema (colores medidos de la tarjeta real)
| Campo | Tipo | Significado |
|---|---|---|
| `colors.primary` | string hex | Color de marca principal. |
| `colors.secondary` | string hex | Secundario. |
| `colors.accent` | string hex | Acento. |
| `colorsText.primary` | string hex | `#ffffff` o `#000000`: color de texto **legible** (WCAG) SOBRE `colors.primary`. |
| `colorsText.secondary` | string hex | Texto legible sobre `secondary`. |
| `colorsText.accent` | string hex | Texto legible sobre `accent`. |

**Cómo usar el tema (obligatorio):** inyectar los hex crudos en `:root` y derivar
el resto con `color-mix`. Ejemplo real (de `executive.html`):

```html
<style>
:root{
  --primary:{{{colors.primary}}};
  --secondary:{{{colors.secondary}}};
  --accent:{{{colors.accent}}};
  --on-primary:{{{colorsText.primary}}};   /* texto legible sobre primary */
  --bg:#f6f5f2;
  --ink:color-mix(in oklab,var(--primary) 88%,#000);
  --line:color-mix(in oklab,var(--primary) 14%,#dedcd6);
}
</style>
```

Reglas de color:
- Los tres hex vienen de medición real de la tarjeta → respetan la identidad del
  negocio. El diseño debe funcionar con CUALQUIER paleta (clara u oscura), no
  asumir colores concretos.
- Para texto sobre un fondo de marca, usar SIEMPRE la variable `colorsText.*`
  correspondiente (ya resuelve contraste WCAG). No hardcodear blanco/negro sobre
  un color de marca.
- Fondos neutros (papel, tinta) pueden ser fijos (`#f6f5f2`, etc.); los acentos
  salen de las vars de marca.

### Meta / extras
| Campo | Tipo | Significado |
|---|---|---|
| `pageTitle` | string | Para `<title>`. |
| `metaDescription` | string | Para `<meta name="description">`. |
| `jsonLd` | string (JSON) | Ficha schema.org. Inyectar **crudo**: `<script type="application/ld+json">{{{jsonLd}}}</script>`. |
| `year` | number | Año actual (footer/copyright). |
| `about` | string | Texto libre "sobre el negocio" (puede ser vacío). |

### Solo para el diseño `credencial` (lista genérica de enlaces)
Los diseños nuevos NO necesitan esto — usan los campos planos de arriba. Se
documenta por completitud:
- `hasLinks` / `links[]` con `{label, url, kind, icon (SVG crudo), primary?, external?}`
- `whatsapp` (`{url, icon}` | null), `address` (`{lines[], mapsUrl, mapsIcon}` | null)

## Estructura recomendada del `<head>`

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{pageTitle}}</title>
<meta name="description" content="{{metaDescription}}">
<script type="application/ld+json">{{{jsonLd}}}</script>
<!-- (opcional) Google Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=TU_FUENTE&display=swap" rel="stylesheet">
<style> /* todo el CSS acá */ </style>
</head>
```

## Cómo registrar el diseño (después de crear el `.html`)

1. Tirar `mi-diseno.html` en `src/dc-templates/`. Ya entra al pool.
2. Agregar su etiqueta en `src/config/rubro-map.ts` → `CARD_LABELS`:
   ```ts
   "mi-diseno": { name: "Mi Diseño", audience: "Rubro objetivo" },
   ```
   (Sin esto igual funciona, pero el chip del visor sale con el nombre de archivo
   capitalizado y sin público objetivo.)
3. (Opcional) Si querés que abra primero para algún rubro, tocar
   `RUBRO_TEMPLATE_ORDER` en el mismo archivo.
4. El test `tests/deterministic/build-cards.test.ts` renderiza CADA template del
   pool con datos de prueba: si el diseño tiene una sección mal cerrada o rompe el
   render, el test falla. Correr `pnpm test`.

## Qué entregarle al agente de diseño (los recursos)

Además de este brief, pasarle:
- **Imágenes de referencia:** la carpeta `linktree inspiration/` (1.png … 8.png).
- **Un ejemplo real completo:** `src/dc-templates/executive.html` (patrón de
  campos planos) y/o `luxury.html`, `clinic.html`, `dark.html`.
- **La foto de la tarjeta del lead** si se está diseñando contra un caso real.
- Consigna de estilo concreta: público objetivo, tono (ej. "lujo sobrio", "tech
  minimal", "cálido cercano") y 1–2 diseños del pool a NO parecerse (para que no
  repita lo que ya existe).

## Checklist final antes de dar por hecho un diseño

- [ ] Un solo `.html`, self-contained (solo Google Fonts como externo).
- [ ] Sin `alert`/`confirm`/`prompt`.
- [ ] Todo dato opcional guardado con su `{{#hasX}}`.
- [ ] Colores desde `{{{colors.*}}}` + `colorsText.*` (funciona con cualquier paleta).
- [ ] `{{{jsonLd}}}` crudo en el `<script>`.
- [ ] Se ve bien de 320px a desktop, dentro de un iframe a pantalla completa.
- [ ] Links externos con `target="_blank" rel="noopener"`.
- [ ] `pnpm test` pasa (render del pool + visor).
- [ ] Entrada en `CARD_LABELS`.

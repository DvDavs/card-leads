# NOTAS — build-web (4 plantillas doctor + visor web)

Notas del trabajo que parametrizó las 3 plantillas doctor restantes y armó el
visor web swipeable. Idioma: español neutro (convención del repo).

## Discrepancias encontradas vs. lo asumido en el encargo

1. **La plantilla molde no era `doctor/index.html`.** El encargo la nombraba
   así, pero el código real (`build-web.ts`) y su test usaban
   `src/templates/doctor/dr_arefin.html`. Se respetó `dr_arefin.html` como
   molde (es la que está bien parametrizada y testeada). `doctor/index.html`
   sigue siendo un mockup crudo sin cablear.

2. **`dental2.html` y `swarnim_dental.html` NO estaban en `doctor/`.** Vivían
   en `src/templates/dental/`. Las versiones **parametrizadas** se crearon en
   `src/templates/doctor/` (junto a `dr_arefin.html` y `doctor.html`), que es
   donde `build-web` las busca. Los mockups crudos originales en `dental/`
   quedaron **intactos** (no se borraron; fuera de alcance).

3. **`src/templates/doctor/` tiene 8+ mockups crudos**, no solo las 4 útiles:
   `index.html`, `generated-page.html`, `dr_lekota_clinic.html`,
   `green_brook_family_care.html`, `swarnim_medical_care.html`,
   `urgencias_24h.html`, etc. Ninguno consume `buildWebView`. Por eso **NO se
   puede globear la carpeta** como hace `build-cards` con `src/dc-templates/`:
   se usó una **lista curada** (`WEB_TEMPLATES` en `build-web.ts`).

## Decisiones tomadas sin preguntar (según instrucción del encargo)

- **Lista curada, no glob.** Tradeoff: agregar una plantilla web exige sumar
  su entrada a `WEB_TEMPLATES` (no es 100% "tirar un archivo y listo" como el
  pool de cards). Se prefirió esto a mover/borrar los mockups crudos, porque
  borrar archivos ajenos estaba fuera de alcance y era más riesgoso.
- **Las 4 plantillas comparten el mismo `buildWebView`.** No se agregó ningún
  campo al view object ni al schema. Donde un mockup tenía una sección sin dato
  (grilla de equipo en swarnim, formulario en dental2), se resolvió con lo que
  hay (about + credenciales + value_props) o se eliminó.
- **Visor web = clon del de cards, SIN brand-toggle + con lazy-load real.** Las
  webs usan las CSS vars de marca directo (no tienen la doble paleta
  original/marca de las digital cards), así que el toggle no aplica y se quitó.
  El lazy-load (`data-src` + `ensureLoaded` ±1) es el cambio clave de
  rendimiento: 4 webs con Tailwind CDN + iconify + fuentes no pueden cargar
  todas a la vez en un teléfono.
- **`generated.web_url` sigue siendo `web/index.html`** (ahora el visor, antes
  la única web).
- **Labels/audiencia de cada diseño** (chip del visor: "Clasico / Lujo /
  Moderno / Limpio") se hardcodearon en `build-web.ts` (`WEB_TEMPLATES`). No se
  tocó `rubro-map.ts` para no ampliar alcance.

## Andamiaje removido de cada mockup (por si aparecen más iguales)

- `doctor.html` (lujo): Google Analytics/gtag `G-2M6V79H761`, botón flotante
  "Sticky Mobile Call" con tel hardcodeado, menú móvil con JS, badge de rating
  "4.9/5", form de "Solicitar Cita".
- `dental2.html` (moderno): `promotekit_referral`, form de reserva, 2 fotos
  stock (oficina + "Patient Smile" de CDNs externos), barra de emergencias con
  dirección/teléfono fijos de un consultorio de NJ.
- `swarnim_dental.html` (limpio): grilla de EQUIPO con 5 caras stock y nombres
  inventados, fotos de Unsplash + Supabase, stats `25K+/15K+/20Y+`, trust badge
  con avatares, form de "Appointment", íconos lucide vía unpkg (→ iconify).

## Dudas abiertas / pendientes (no bloquean; anotadas para el futuro)

- **¿Limpiar `src/templates/doctor/` y `dental/`?** Si se borran/mueven los
  mockups crudos sobrantes, `build-web` podría pasar a globear la carpeta (como
  `build-cards`) y volverse "tirar un archivo = nueva plantilla". Alternativa
  menos invasiva: mover las 4 parametrizadas a una subcarpeta dedicada
  (p.ej. `src/templates/doctor/web/`) y globear ESA. No se hizo ahora por
  alcance; queda como mejora.
- **Otros rubros sin plantilla web.** `barberia`, `estetica`, `veterinario`,
  `nutriologo`, `otro` no tienen entrada en `WEB_TEMPLATES` → `build-web` lanza
  un error claro. Falta parametrizar sus mockups cuando toque.
- **Verificación visual real pendiente.** El lazy-load, el chip y el swipe se
  validaron con test determinista + render en disco (0 marcadores `{{`
  residuales), pero NO se probó en un navegador/teléfono real. Recomendado
  antes de mostrarlo a un cliente:
  `npx serve leads/carlos-cred/web -l 5055` y swipear en móvil.
- **`dr_arefin.html` como primer diseño del visor.** Se dejó primero por ser el
  más pulido/probado. Si se quiere que el primero dependa del sub-perfil del
  lead (como `orderPoolByRubro` en cards), habría que agregar esa lógica.

## Segunda pasada — "completar todas las plantillas"

Se clasificó TODO lo que quedaba bajo `src/templates/` (13 archivos) y se
parametrizaron los **3 diseños distintos reales** que faltaban, todos en
`src/templates/doctor/` y ya cableados en `WEB_TEMPLATES` (total: **7 diseños
doctor**):

- `urgencias_24h.html` — premium 24h. Removido: Google Analytics
  (`G-2M6V79H761`), script `aura-preview-performance-controller`, slideshow de
  fotos stock (supabase/unsplash), formulario, iframe de Maps hardcodeado.
- `dr_lekota_clinic.html` — clínica familiar, tarjetas flotantes. Venía
  **minificado en 1 línea** → desminificado. Removido: fotos unsplash+supabase,
  21 de 22 `<link>` de Google Fonts sin usar, datos duros inventados.
- `generated-page.html` — perfil individual estilo CV. Removido: headshot
  unsplash, formulario. Las secciones sin campo en el contrato (Experiencia
  timeline, Investigación) se ELIMINARON (no se inventaron datos); Educación →
  `attrs`, Skills → `services`. Se AGREGARON las secciones que el contrato/test
  exigen y el CV no traía (testimonios, horario, disclaimer).

### Descartes deliberados (no son "diseños nuevos", NO se parametrizaron)

- `doctor/green_brook_family_care.html` — **mismo diseño** que `dental2.html`
  (ya hecho): misma base/CSS/layout, solo cambiaba el copy (que ahora viene del
  lead, no del template). Parametrizado renderizaría IDÉNTICO → sería un
  duplicado en el visor. Su gemelo dental (`dental/dental2.html`) es el source
  del ya-hecho `doctor/dental2.html`.
- `doctor/swarnim_medical_care.html` — **mismo diseño** que `swarnim_dental.html`
  (ya hecho). Mismo caso: redundante.
- `dental/dental.html`, `dental/dental2.html`, `dental/swarnim_dental.html`,
  `dental/tooth_fairy_dental.html` — sources crudos / gemelos por rubro de los
  diseños ya cubiertos. `dental.html` es el gemelo de `urgencias_24h`;
  `tooth_fairy_dental` el de `dr_lekota_clinic`. No se wirearon (mismo diseño).
- `doctor/index.html`, `barberia/index.html`, `estetica/index.html` — **stubs
  rotos** de 13 líneas, parametrizados contra un contrato viejo (`{{name}}`, no
  `{{heroName}}`), con comentario "stub, aun no implementado". No sirven; la
  lista curada los ignora.
- `generico/index.html` — **artefacto de OTRO contrato**: es una copia recortada
  de `dc-templates/credencial.html`, parametrizada contra `buildCardView` (las
  digital cards), NO `buildWebView`. Rompería el render si se wirea. Mal ubicado
  bajo `src/templates/`.

### Rubros sin diseños web (pendiente real, requiere trabajo creativo nuevo)

`barberia`, `estetica`, `generico` (y `veterinario`, `nutriologo`) NO tienen
ninguna plantilla web real — solo stubs vacíos o el artefacto de arriba. No se
pueden "completar" parametrizando: hay que **diseñar mockups nuevos** para esos
rubros (fuera del alcance de "parametrizar lo existente"). `build-web` sigue
lanzando error claro para ellos. Los 7 diseños doctor, en cambio, sirven para
cualquier lead doctor.

### Limpieza pendiente sugerida (no bloquea)

Los stubs rotos (`doctor/index.html`, `barberia/index.html`,
`estetica/index.html`), el artefacto (`generico/index.html`) y los gemelos
crudos redundantes (`green_brook_family_care.html`, `swarnim_medical_care.html`,
`dental/*`) siguen en disco. La lista curada los ignora, así que no molestan,
pero conviene borrarlos/moverlos si algún día se quiere pasar `build-web` a
glob (auto-descubrimiento como `build-cards`). No se borraron ahora por
prudencia (no los creé yo; se prefirió surfacear antes que borrar).

## Tercera pasada — QA visual en navegador (los tests de string no alcanzan)

Los tests deterministas chequean STRINGS, no renderizado. Se sirvió el output
(`npx serve leads/carlos-cred/web -l 5055`) y se abrió cada diseño + el visor en
Chrome. Se encontraron y corrigieron 2 clases de bug que el test no ve:

1. **Chip del visor pisaba la barra de nav de cada web** (desktop). El chip
   "Diseño · n/7" estaba arriba-centro, justo sobre el menú del `<nav>` de las
   webs (tapaba un link). Movido ABAJO, apilado sobre los dots (ambos pills
   glassy centrados). En móvil el menú de la web se oculta, pero abajo funciona
   en los dos. Fix en `src/templates/doctor/_viewer.html` (`.chip`).

2. **Nombres de icono inventados por el LLM** → íconos vacíos (cajas grises). El
   web component `<iconify-icon>` baja el SVG de `api.iconify.design` en runtime;
   si el nombre no existe, renderiza NADA (0×0, sin error). Se extrajeron TODOS
   los nombres de icono de las 7 plantillas y se validaron contra la API: 4
   nombres `solar:*` no existen. Corregidos:
   - `dental2.html`: `solar:tooth-linear` (×3, logo/chip/footer) → `solar:health-linear`;
     `solar:quote-up-linear` (testimonios) → `ri:double-quotes-l`.
   - `doctor.html`: `solar:instagram-linear` → `ri:instagram-line`;
     `solar:facebook-linear` → `ri:facebook-fill` (estaban gated por `hasSocials`,
     así que no rompían con el lead dorado, pero sí con cualquier lead con redes).
   - Los otros 5 diseños (lucide/ri/brandico/ph) tenían TODOS los nombres válidos.
   - **Gotcha para el futuro:** `solar` NO tiene íconos `tooth` ni `quote`
     (buscar "tooth" en solar solo da "bluetooth"). Al parametrizar un mockup
     nuevo con `<iconify-icon>`, validar los nombres contra
     `https://api.iconify.design/{prefix}.json?icons=a,b,c` (campo `not_found`).

Verificado en navegador (visual + `iconify-icon` con SVG en shadow root):
los **7 diseños** renderizan completos con la paleta de marca, placeholder de
iniciales, secciones (about/servicios/testimonios/horario `Referencial`/FAQ/
contacto/footer). Visor: swipe + flechas + dots + chip + lazy-load (`data-src`,
solo carga la ventana visible ±1) + `startViewTransition` — todo OK.

## Estado de verificación al cerrar

- `pnpm typecheck` → limpio.
- `pnpm test` → **386 tests verdes** (9 archivos; `build-web.test.ts` = 93: el
  `describe.each` recorre las 7 plantillas + el visor).
- `pnpm cli build-web carlos-cred` → OK. Genera los **7** `web/*.html`
  (`dr_arefin, doctor, dental2, swarnim_dental, urgencias_24h, dr_lekota_clinic,
  generated-page`) + `web/index.html` (visor). `data.json`: `status =
  web_built`, `generated.web_url = "web/index.html"`. Salida en disco: 0
  marcadores `{{` residuales, 0 andamiaje (unsplash/gtag/supabase/aura/promotekit).
- **QA visual en Chrome** (los 7 diseños + visor): renderizado correcto, íconos
  cargando, sin cajas vacías, chip sin solapar la nav.
- Nota: los íconos (iconify) se bajan de `api.iconify.design` en runtime → la web
  publicada necesita internet (esperado; no es self-contained, igual que Tailwind
  CDN y Google Fonts).

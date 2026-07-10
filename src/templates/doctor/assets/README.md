# Banco de imágenes locales — plantillas web de doctor

Este directorio contiene el banco de imágenes local y etiquetado que usan las
7 plantillas de `helpers/web-templates/doctor/doc-*.html` (clasico, familiar,
limpio, lujo, moderno, perfil, urgencias) al pasar por `build-web`. Reemplaza
las referencias externas originales (images.unsplash.com, *.supabase.co,
cdn.website.thryv.com, lirp.cdn-website.com) para que la selección de
imágenes sea determinística y no dependa de servicios de terceros ni de
fotos de negocios reales.

## Convención de tags

Cada imagen tiene un **tag** en PascalCase + índice de 2 dígitos:

```
<Kind><Genero?><NN>
```

Ejemplos: `RetratoDoctor01`, `RetratoDoctora01`, `ConsultorioDoctor02`,
`EquipoDoctor01`, `SonrisaPaciente01`, `RecepcionClinica01`.

El archivo físico (`file` en el manifest) puede tener cualquier extensión de
imagen (`.jpg`, `.png`, `.webp`); el tag es el identificador estable que usa
el código, no el nombre de archivo.

## Kinds (tipos)

| kind          | uso                                                | género | mínimo requerido |
| ------------- | --------------------------------------------------- | ------ | ----------------- |
| `retrato`     | foto de doctor/a de perfil (hero, tarjetas de equipo) | sí (`m`/`f`) | 6 (3m / 3f) |
| `consultorio` | interior de clínica/consultorio (hero, slider urgencias) | no | 4 |
| `equipo`      | foto de equipo/personal médico en grupo             | no     | 2 |
| `sonrisa`     | sonrisas de pacientes / resultados de tratamiento    | no     | 2 |
| `recepcion`   | recepción / sala de espera                          | no     | 2 |

## manifest.json

`manifest.json` es la fuente de verdad. Cada entrada tiene:

```json
{ "tag": "RetratoDoctor01", "file": "RetratoDoctor01.jpg", "kind": "retrato", "gender": "m" }
```

- `tag`: identificador estable (PascalCase + índice de 2 dígitos).
- `file`: nombre del archivo dentro de este mismo directorio.
- `kind`: uno de los 5 valores de la tabla de arriba.
- `gender`: solo para `kind: "retrato"` (`"m"` o `"f"`). Se omite en el resto.

`build-web` lee este manifest para elegir determinísticamente qué imagen usar
en cada rol de cada plantilla (en vez de depender de URLs externas o de un
LLM para "adivinar" una foto).

## Cómo agregar o reemplazar una imagen

1. Conseguí una imagen libre de derechos (preferentemente Unsplash, licencia
   Unsplash — gratuita, sin atribución obligatoria) o un asset propio del
   negocio, ~1200px en el lado más largo, formato jpg/png (webp si tenés
   `magick`/`cwebp` a mano para convertir).
2. Copiá el archivo a este directorio con un nombre de archivo descriptivo
   (no hace falta que coincida con el tag, pero ayuda si coincide).
3. Agregá una entrada nueva en `manifest.json` con `tag`, `file`, `kind` y
   (si es `retrato`) `gender`. Mantené el índice de 2 dígitos correlativo
   dentro de ese `kind`/`gender`.
4. Verificá visualmente la imagen antes de commitear: que el género declarado
   coincida con lo que se ve, que el contenido corresponda al `kind`
   declarado (un consultorio es un consultorio, una sonrisa es una sonrisa),
   y que no tenga branding real visible (ver regla abajo).
5. Corré `node -e "JSON.parse(require('fs').readFileSync('src/templates/doctor/assets/manifest.json'))"`
   (o cualquier chequeo similar) para confirmar que el JSON sigue siendo
   válido.

## Regla: sin branding de negocios reales

Ninguna imagen de este banco puede mostrar el logo, nombre, cartelería o
identidad visual de un negocio real (clínica, consultorio, marca) — ni
propio ni de terceros. El objetivo es que las plantillas sean genéricas y
reutilizables para cualquier cliente. Si una imagen depende de un asset de
un negocio real (por ejemplo, capturada de su sitio o su CDN), hay que
reemplazarla por una foto genérica equivalente (de stock/Unsplash) antes de
sumarla al manifest.

Dos casos ya resueltos al armar este banco: las fotos originales de
`doc-moderno.html` alojadas en `cdn.website.thryv.com` y
`lirp.cdn-website.com` (interior + sonrisa de paciente) pertenecían a una
clínica real identificable y se reemplazaron por equivalentes genéricos de
Unsplash (ver `ConsultorioDoctor*` y `SonrisaPaciente*`).

## Tamaño

Las imágenes se descargan/exportan a ~1200px en el lado más largo
(`w=1200&q=80` para Unsplash), suficiente para hero images a ancho completo
sin inflar el peso del repo. No hace falta subir originales a resolución
completa.

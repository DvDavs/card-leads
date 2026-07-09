# Diseños nuevos del pool — notas de integración

## Archivos
Copiar a `src/dc-templates/`:
- `celeste.html` · aireado, motivos flotando en esquinas (preview: doctor)
- `vitrina.html` · escena apoyada en el borde inferior, fondo tintado (preview: nutriologo)
- `rotulo.html` · póster tipográfico sobre fondo de marca, sello gigante (preview: barberia)
- `seda.html` · serif elegante, hairlines, motivos delicados (preview: estetica)
- `redondo.html` · píldoras amigables, caminito de sprites (preview: veterinario)
- `lienzo.html` · geométrico editorial, marco y numeración (preview: otro)
- `_motifs.html` · **librería de motivos** (no entra al pool por el prefijo `_`)

## CARD_LABELS (src/config/rubro-map.ts)
```ts
"celeste": { name: "Celeste", audience: "Salud y consultorios" },
"vitrina": { name: "Vitrina", audience: "Nutrición y bienestar" },
"rotulo":  { name: "Rótulo",  audience: "Barberías y oficios" },
"seda":    { name: "Seda",    audience: "Estética y belleza" },
"redondo": { name: "Redondo", audience: "Veterinarias y cercanía" },
"lienzo":  { name: "Lienzo",  audience: "General (default)" },
```

## Capa de motivos (swap por rubro)
Cada diseño trae UN bloque entre `<!-- MOTIF:START (rubro=X) -->` y `<!-- MOTIF:END -->`,
justo al inicio del `<body>`. Para cambiar de rubro: borrar ese bloque y pegar el del
rubro deseado desde `_motifs.html`. El wrapper `<div class="motif">` y los sprites
`.m1`–`.m5` son idénticos en los 6 bloques; el CSS de cada diseño decide posición,
tamaño, opacidad y animación, y el color sale de `currentColor` → paleta de marca.
Cualquier bloque funciona en cualquier diseño.

## CAMPO NUEVO PROPUESTO: `photoPath` (imagen circular)
Los 6 diseños incluyen un avatar circular con esta cascada:

```
{{#photoPath}} <img class="avatar" src="{{photoPath}}"> {{/photoPath}}
{{^photoPath}}
  {{#logoPath}} <img class="avatar" src="{{logoPath}}"> {{/logoPath}}
  {{^logoPath}} <div class="avatar avatar-ini">{{initial}}</div> {{/logoPath}}
{{/photoPath}}
```

`photoPath` NO existe todavía en el view del pipeline. Mientras no se agregue, el
motor lo resuelve como falsy y el avatar cae solo al logo o a la inicial — no rompe
nada. Para activarlo: agregar `photoPath` (string, ruta local a una foto cuadrada,
ej. retrato del profesional) al armar el view en `build-cards`. Sin URL externa:
ruta relativa dentro de `leads/<slug>/` o data URI.

## Otras notas
- Servicios: se muestran los primeros 6; si hay 7+, aparece "Ver todos"
  (checkbox CSS puro, sin JS, no rompe el visor).
- `vcard`: los 6 diseños traen el link "Guardar contacto" guardado con `{{#vcard}}`.
- `about`: guardado con `{{#about}}`, se renderiza solo si existe.
- Animaciones: CSS puro, con `prefers-reduced-motion` respetado.

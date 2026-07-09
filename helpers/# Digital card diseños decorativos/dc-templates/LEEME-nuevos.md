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

## Diseños Guelaguetza (turno 2)
Tres diseños temáticos ESTÁTICOS — misma paleta y arte en todos los rubros, solo cambian los datos:
- `guelaguetza-pina.html` · "Piña" — crema, sarape + papel picado, bailarina Flor de Piña en el header
- `guelaguetza-calenda.html` · "Calenda" — lavanda, globo de calenda flotando + china oaxaqueña al pie, confeti
- `guelaguetza-tehuana.html` · "Tehuana" — ciruela oscuro con oro, muñeca tehuana en header, falda al pie

Reglas:
- Ignoran `colors`/`colorsText` del pipeline a propósito (paleta fija de fiesta).
- SÍ llevan capa MOTIF: los bloques de `_motifs.html` se swapean por rubro igual que en el resto del pool, pero el CSS los tiñe con un color FIJO de la paleta guelaguetza (magenta en piña, uva en calenda, oro en tehuana) — nunca con la marca del cliente.
- Bloques de preview: piña=doctor, calenda=nutriologo, tehuana=barberia.
- Sus imágenes viven en `assets/guelaguetza/` (flor-de-pina, china-oaxaquena, globo-oaxaca, tehuana, falda-amarilla) y son EXCLUSIVAS de los diseños `guelaguetza-*`: ningún otro diseño del pool debe referenciarlas.
- Rutas de imagen relativas (`assets/guelaguetza/...`): copiar esa carpeta junto a los templates al integrarlos; ajustar la ruta si el pipeline sirve desde otra base.
- Mantienen el contrato completo del view (avatar cascade con photoPath, vcard, about, "Ver todos", prefers-reduced-motion).

### CARD_LABELS sugeridos
```ts
"guelaguetza-pina":    { name: "Guelaguetza · Piña",    audience: "Todos los rubros" },
"guelaguetza-calenda": { name: "Guelaguetza · Calenda", audience: "Todos los rubros" },
"guelaguetza-tehuana": { name: "Guelaguetza · Tehuana", audience: "Todos los rubros" },
```

## Otras notas
- Servicios: se muestran los primeros 6; si hay 7+, aparece "Ver todos"
  (checkbox CSS puro, sin JS, no rompe el visor).
- `vcard`: los 6 diseños traen el link "Guardar contacto" guardado con `{{#vcard}}`.
- `about`: guardado con `{{#about}}`, se renderiza solo si existe.
- Animaciones: CSS puro, con `prefers-reduced-motion` respetado.

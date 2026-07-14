# src/templates/assets — imágenes placeholder para las plantillas WEB

Librería de imágenes para las plantillas web (`src/templates/`), organizada por
los dos ejes que definen qué imagen mostrar:

- **Género del doctor:** `neutral` · `female` · `male` (`neutral` es el default
  cuando no se conoce el género — no se infiere del nombre).
- **Especialidad / tipo de doctor:** `general` · `dental` · `aesthetic` (estético)
  · `surgeon` (cirujano). Define el consultorio y el acento/insignia del retrato.

```
assets/
  doctors/   doctor-<especialidad>-<genero>.svg   (4 × 3 = 12 retratos)
  offices/   office-<especialidad>.svg            (4 consultorios)
```

## Por qué son SVG ilustrados y no fotos

1. **`CLAUDE.md` prohíbe generar caras/fotos falsas de personas.** Estos son
   PICTOGRAMAS planos (sin rostro), no retratos de personas inventadas.
2. El entorno de trabajo bloquea descargar fotos de stock (Unsplash/Pexels/etc.
   dan `403` por política de red).
3. El repo es *self-contained* (SVG inline / data URI); estas imágenes no
   dependen de ninguna URL remota.

## Cómo se generan / regeneran

Son **deterministas**: las produce un script, no se editan a mano.

```bash
node scripts/gen-template-images.mjs
```

Para cambiar colores, iconos de especialidad o el estilo de pelo/uniforme, se
edita `scripts/gen-template-images.mjs` y se re-corre.

## Cómo reemplazarlas por fotos reales

Cuando haya **fotos reales con licencia**, se dejan caer con el **mismo nombre
de archivo** (ej. `doctors/doctor-dental-female.svg` → `.jpg`/`.png`) y se ajusta
la extensión en el manifest. El selector (`src/config/doctor-images.ts`) las
toma sin más cambios de código. No usar caras/fotos falsas de personas
(ver `CLAUDE.md`): solo material real del negocio o placeholders como estos.

## Cómo se eligen en código

`src/config/doctor-images.ts` (puro, testeado en
`tests/deterministic/doctor-images.test.ts`):

- `pickDoctorImage(lead)` / `pickOfficeImage(lead)` — leen
  `business.attrs.especialidad` y `business.attrs.genero`; caen a la especialidad
  del rubro (`estetica` → `aesthetic`, resto → `general`) y a género `neutral`.
- `doctorImage(especialidad, genero)` / `officeImage(especialidad)` — arman la
  ruta directa.
- `normalizeSpecialty()` / `normalizeGender()` — mapean texto libre (español o
  inglés) a los enums.
- `DOCTOR_IMAGE_MANIFEST` — lista completa de assets (la usa el test y la usará
  `build-web` para saber qué copiar al lead).

> `build-web` es stub hoy; cuando se implemente, copiará el asset elegido dentro
> de `leads/<slug>/` igual que `build-cards` espeja los assets de Guelaguetza.

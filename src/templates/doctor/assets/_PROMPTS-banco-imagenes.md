# Prompts de banco de imágenes — plantillas web (rubro `doctor`)

Catálogo de prompts para generar el banco de imágenes de
`src/templates/doctor/assets/` con **nano banana** (o cualquier modelo de
imagen). Cubre las dos variantes de especialidad que necesitamos hoy:
**médico general (`doctor`)** y **dental (`dental`)**.

## Cómo leer este documento

Las imágenes NO se definen por plantilla: viven en un **banco compartido por
_kind_** (`manifest.json`) y cada plantilla jala slots de ese banco. Por eso los
prompts están organizados **por tipo de imagen (kind)**, no por plantilla.

- **§1** — imágenes que usa cada plantilla (el "N por plantilla").
- **§2** — sufijo de estilo + negativos que se pega a TODOS los prompts.
- **§3** — catálogo de prompts por kind × especialidad × género.
- **§4** — cómo nombrar los archivos y meterlos al `manifest.json`.

Los prompts están en **inglés a propósito**: los modelos de imagen responden más
consistente en inglés. Los datos del negocio (nombre, especialidad) los pone el
pipeline después; estas fotos son genéricas y recoloreables.

Contexto de mercado: leads mexicanos. Preferir **apariencia latina / mexicana**,
tonos de piel cálidos, entornos que se lean como una clínica real de LATAM (no un
render gringo de stock).

---

## §1. Imágenes por plantilla (cuántas y cuáles)

| Plantilla | N | Slots (kind) |
|---|:-:|---|
| `doc-lujo` | 0 | — (solo texto) |
| `doc-clasico` | 1 | `retrato_principal` (retrato · género del lead) |
| `doc-perfil` | 1 | `retrato_principal` (retrato · género del lead) |
| `doc-moderno` | 2 | `consultorio_01` · `sonrisa_01` |
| `doc-familiar` | 2 | `hero_01` (consultorio/recepción) · `consultorio_01` |
| `doc-urgencias` | 3 | `hero_01` · `hero_02` (consultorio/recepción) · `consultorio_01` |
| `doc-limpio` | 6 | `retrato_principal` · `avatar_01/02/03` (retratos) · `hero_01` · `consultorio_01` (+5 retratos de equipo demo) |

**Slots → kind del banco** (así resuelve `build-web.ts`):

| Slot | Kind del banco | Nota |
|---|---|---|
| `img_retrato_principal` | `retrato` | filtra por género del lead; si el lead trae foto real, se usa esa |
| `img_avatar_01/02/03` | `retrato` | retratos mixtos, distintos del principal |
| retratos de equipo (`nuestro_equipo`) | `retrato` | por género de cada miembro demo |
| `img_hero_01/02` | `consultorio` + `recepcion` | instalaciones a lo ancho |
| `img_consultorio_01/02` | `consultorio` | |
| `img_equipo_01` | `equipo` | grupo del staff |
| `img_sonrisa_01` | `sonrisa` | primer plano de resultado |
| `img_recepcion_01` | `recepcion` | sala de espera |

> Con generar bien los **5 kinds** en sus dos especialidades, quedan cubiertas
> las 7 plantillas. No hace falta una foto por plantilla.

**Digital cards (`src/dc-templates/`):** solo usan un avatar circular (`photoPath`,
aún no cableado en el pipeline) o la inicial. No suman necesidades nuevas: el
avatar es un `retrato` (reusa los prompts de §3.1). Las Guelaguetza tienen arte
fijo propio, no se tocan por especialidad.

---

## §2. Sufijo de estilo + negativos (pegar a TODO prompt)

Agregá esto al final de **cada** prompt de §3:

**STYLE SUFFIX:**
```
photorealistic, natural soft daylight, shallow depth of field, shot on 50mm lens,
clean modern professional look, neutral balanced color grade, high detail, 1200px
long edge, Latin American / Mexican setting and people
```

**NEGATIVE (lo que NO queremos):**
```
no visible brand logos, no clinic names, no readable text or signage, no watermark,
no stock-photo watermark, not overly saturated, no harsh flash, no distorted hands,
no extra fingers, no plastic AI skin, no fake teeth in medical shots, no gore
```

Reglas duras del banco (del README):
- **Cero branding real** (logos, nombres de clínica, cartelería). Genérico y
  reutilizable.
- Tono neutro para que la doble paleta de marca no pelee con la foto.
- Verificá que el **género** y el **kind** coincidan con lo que se ve antes de
  meterlo al manifest.

---

## §3. Catálogo de prompts por kind

Para los kinds con mínimo > 1, generá **N variaciones** cambiando edad, etnia y
pose (mismo prompt base) para llenar los índices `01`, `02`, `03`.

### 3.1 `retrato` — retrato de profesional  ·  mínimo 6 (3m / 3f)

Encuadre: **vertical 3:4** (hero/tarjeta). Para avatares el pipeline lo recorta a
círculo, así que centrá cara y hombros.

**Doctor (médico general, masculino) — `RetratoDoctor01..03`**
```
Portrait of a confident Mexican male doctor in his 40s, short dark hair, warm
friendly expression, wearing a clean white medical coat over a light blue shirt
with a stethoscope, standing in a bright modern clinic, softly blurred background,
head-and-shoulders framing, looking at camera
```

**Doctora (médica general, femenino) — `RetratoDoctora01..03`**
```
Portrait of a professional Mexican female doctor in her 30s-40s, hair tied back,
warm approachable smile, wearing a clean white medical coat over a blouse with a
stethoscope, bright modern clinic softly blurred behind, head-and-shoulders
framing, looking at camera
```

**Dentista (dental, masculino) — `RetratoDentista01..03`**
```
Portrait of a friendly Mexican male dentist in his 30s-40s, wearing dental scrubs
or a white coat, a dental loupe/glasses optional, warm confident smile, standing in
a bright modern dental office with a dental chair softly blurred behind,
head-and-shoulders framing, looking at camera
```

**Dentista (dental, femenino) — `RetratoDentista01..03` (fem.)**
```
Portrait of a friendly Mexican female dentist in her 30s, wearing clean dental
scrubs, hair tied back, warm reassuring smile, bright modern dental office with a
dental chair and operatory light softly blurred behind, head-and-shoulders framing,
looking at camera
```

> Para el banco dental, mantené 3m / 3f igual que el médico general.

### 3.2 `consultorio` — interior de consultorio  ·  mínimo 4

Encuadre: **horizontal 3:2**. Sin personas o con una persona de fondo desenfocada.

**Doctor (consultorio médico) — `ConsultorioDoctor01..04`**
```
Interior of a modern medical consultation room, examination table with clean white
paper roll, a tidy desk with a computer, neutral walls, medical cabinet, plants,
bright natural light from a window, welcoming and clean, no people, wide interior shot
```

**Dental (consultorio dental) — `ConsultorioDental01..04`**
```
Interior of a modern dental operatory, a dental chair with an overhead operatory
light and instrument tray, clean minimalist cabinetry, neutral calming walls, bright
natural light, spotless and inviting, no people, wide interior shot
```

### 3.3 `equipo` — foto de grupo del staff  ·  mínimo 2

Encuadre: **horizontal 3:2**. Grupo de 3–5 personas.

**Doctor (equipo médico) — `EquipoDoctor01..02`**
```
Group photo of a friendly Mexican medical team of 4 people (doctors and nurses) in
white coats and scrubs, standing together in a bright modern clinic hallway,
natural warm smiles, looking at camera, professional and approachable
```

**Dental (equipo dental) — `EquipoDental01..02`**
```
Group photo of a friendly Mexican dental team of 4 people (dentist, hygienists,
assistant) in matching clean scrubs, standing together in a bright modern dental
clinic, natural warm smiles, looking at camera, professional and approachable
```

### 3.4 `sonrisa` — primer plano tipo resultado  ·  mínimo 2

Encuadre: **cuadrado 1:1** o **4:3**, primer plano.

**Doctor (paciente sano/satisfecho) — `SonrisaPaciente01..02`**
```
Close-up of a happy healthy Mexican patient smiling naturally in a bright clinic,
relaxed and confident, soft natural light, genuine warm expression, face and
shoulders, no medical instruments
```

**Dental (resultado de sonrisa) — `SonrisaDental01..02`**
```
Close-up of a natural healthy smile of a Mexican patient with clean white teeth,
bright and genuine, soft natural light, focus on the mouth and lower face, realistic
teeth (not artificially perfect), dental clinic context
```

### 3.5 `recepcion` — recepción / sala de espera  ·  mínimo 2

Encuadre: **horizontal 3:2**. Sin personas o con recepcionista de fondo.

**Doctor (recepción médica) — `RecepcionClinica01..02`**
```
Modern medical clinic reception and waiting area, clean front desk, comfortable
waiting chairs, warm neutral tones, plants, bright natural light, welcoming and
tidy, no readable signage, wide interior shot
```

**Dental (recepción dental) — `RecepcionDental01..02`**
```
Modern dental clinic reception and waiting area, clean front desk, comfortable
waiting chairs, calming neutral palette, plants, bright natural light, welcoming and
spotless, no readable signage, wide interior shot
```

---

## §4. Nombrado y alta en el manifest

Cuando tengas las imágenes de nano banana:

1. Exportá a ~1200px lado largo, `.jpg`/`.png`/`.webp`.
2. Copiá a `src/templates/doctor/assets/` con el nombre del **tag**.
3. Agregá cada una a `manifest.json`:
   ```json
   { "tag": "RetratoDentista01", "file": "RetratoDentista01.jpg", "kind": "retrato", "gender": "m" }
   ```
   - `kind`: uno de `retrato | consultorio | equipo | sonrisa | recepcion`.
   - `gender`: SOLO para `retrato` (`"m"` / `"f"`).
4. Verificá visual: género correcto, kind correcto, **sin branding real**.

### Sub-rubro dental — YA CABLEADO (implementado)

Ya está resuelto (opción A): el manifest tiene un campo **`specialty`**
(`general` | `dental`) y `build-web` elige por especialidad además de por
`kind`/`gender`. `detectSpecialty(lead)` mira los datos reales del lead (nombre,
tagline, servicios, etc.) y si menciona odontología pinta la web con el set
dental; si no, con el general. Si falta stock dental de un kind, cae al general
(sin slots vacíos). Detalle completo en `README.md` → "Sub-rubro (specialty)".

Para sumar imágenes: generalas con estos prompts, nombralas con el tag del set
correcto (`*Dental*` / `*Dentista*` para dental) y agregá la entrada al manifest
con `"specialty": "dental"`. Nada más que tocar en el código.

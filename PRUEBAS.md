# Cómo probar card-leads

Pipeline CLI: fotos de tarjeta de presentación → datos estructurados → linktree.
Esta guía cubre el flujo completo, etapa por etapa, con los comandos exactos.

> Terminal: los ejemplos funcionan en **PowerShell de Windows** y en bash/zsh.
> Donde hay diferencia, se aclara.

---

## 1. Requisitos previos

- **Node.js ≥ 20.12** (se usa `process.loadEnvFile` nativo). Recomendado el que ya
  está probado: **v24**.
- **pnpm** (hay `pnpm-lock.yaml`). Instalar: `npm i -g pnpm`.
- Una **API key de Gemini** (Google AI Studio) para la etapa `extract`.
  Sacala en https://aistudio.google.com/apikey — es gratis.

Verificá Node:

```powershell
node --version   # debe ser >= 20.12
```

---

## 2. Instalación

```powershell
git clone https://github.com/DvDavs/card-leads
cd card-leads
pnpm install
```

---

## 3. Configuración (.env)

El `.env` está **gitignored** (nunca se sube). Copiá el ejemplo y completá la key:

```powershell
# PowerShell
Copy-Item .env.example .env
```
```bash
# bash / zsh
cp .env.example .env
```

Editá `.env` y pegá tu llave en `GEMINI_API_KEY`:

```ini
LLM_PROVIDER=gemini
GEMINI_API_KEY=tu_llave_aca
GEMINI_MODEL=gemini-2.5-flash
GEMINI_TEMPERATURE=0.5
GEMINI_MAX_TOKENS=1000
```

> `openai` es stub por ahora. Dejá `LLM_PROVIDER=gemini`.

---

## 4. Chequeos rápidos (sin API key)

Estos **no** llaman al modelo — corren siempre:

```powershell
pnpm test         # suite de tests deterministas (vitest)
pnpm typecheck    # tsc --noEmit
```

Todo verde = la lógica pura (schema, mapeo, correcciones, migración, colores) está sana.

---

## 5. El pipeline, etapa por etapa

Cada lead vive en `leads/<slug>/data.json` y va avanzando de `status`.
`leads/` está gitignored: es data de terceros, no se sube.

Forma general del comando:

```powershell
pnpm cli <etapa> [args]
```

> Con **npm** en vez de pnpm, los args van tras `--`:
> `npm run cli -- <etapa> [args]`.

### 5.1 `ingest` — guardar las fotos y crear el lead

```
pnpm cli ingest <frente> [reverso] [--slug s] [--rubro r] [--channel c] [--force]
```

Rubros válidos: `doctor` · `barberia` · `estetica` · `veterinario` · `nutriologo` · `otro`.

En el repo hay tarjetas de ejemplo ya versionadas. Ejemplo con frente + reverso:

```powershell
pnpm cli ingest anverso.jpg reverso.jpg --slug dr-karey --rubro doctor
```

Crea `leads/dr-karey/`, copia las fotos y deja el lead en `status=ingested`.
Otros pares de ejemplo: `ej01_an.jpg` / `ej01_re.jpg`, `ej02_an.jpg` / `ej02_re.jpg`.

### 5.2 `extract` — leer la tarjeta con Gemini (requiere API key)

```powershell
pnpm cli extract dr-karey
```

Manda las fotos a Gemini, valida la salida y llena `data.json`.
Avanza a `status=extracted`. **CHECKPOINT humano: no avanza más solo.**
Los `phones` salen como **lista** (varios números si la tarjeta los tiene).

Si la respuesta del modelo no parsea, registra el error en `meta.errors` y **no**
escribe basura; el lead queda en `ingested` para reintentar.

### 5.3 `verify` — checkpoint humano interactivo (sin API key)

```powershell
pnpm cli verify dr-karey
```

Recorre los campos en la terminal. Para cada uno:

- **Enter** = aceptar el valor tal cual.
- Escribir texto = corregirlo.
- `-` = vaciar el campo.

Muestra **primero los campos de riesgo** (donde el modelo barato más falla),
marcados con `⚠ VERIFICAR CONTRA LA TARJETA`:

- **teléfonos** (lista — el modelo cambia dígitos)
- **whatsapp**
- **redes sociales** (el modelo inventa handles)
- **colores de marca** (hex aproximado, con pista de color: `#60B0C0 (≈ turquesa)`)

Teléfonos y servicios se revisan como **lista**: Enter acepta toda, `-` vacía, o
escribís la lista nueva **separada por comas** para reemplazarla entera.

Al final muestra un resumen y pide confirmación `s/n`:

- **`s`** → valida contra el schema estricto (Zod), escribe `data.json`, avanza a
  `status=verified` y limpia de `meta.needs` lo ya resuelto.
- **`n` o Ctrl+C** → **no escribe nada**, el lead sigue en `extracted`.

### 5.4 `build-linktree` — generar el linktree.html

```powershell
pnpm cli build-linktree dr-karey
```

Arma `leads/dr-karey/linktree.html` con botones de contacto y avanza a
`status=linktree_built`. **Cada teléfono genera su propio botón "Llamar"**
(`tel:` limpio) y el whatsapp arma su `wa.me`.

### 5.5 Etapas stub (aún sin implementar)

`build-web`, `deploy`, `proposal`, `package` existen como comandos pero lanzan
"no implementado". No forman parte de la prueba todavía.

---

## 6. Flujo completo de ejemplo

```powershell
pnpm install
Copy-Item .env.example .env       # y pegá GEMINI_API_KEY
pnpm cli ingest anverso.jpg reverso.jpg --slug dr-karey --rubro doctor
pnpm cli extract dr-karey          # llama a Gemini -> status=extracted
pnpm cli verify dr-karey           # revisás/corregís -> status=verified
pnpm cli build-linktree dr-karey   # -> leads/dr-karey/linktree.html
```

Abrí `leads/dr-karey/linktree.html` en el navegador para ver el resultado.

---

## 7. Migración de leads viejos (phone → phones)

Los `data.json` viejos guardaban `contact.phone` como **un solo string**. Ahora es
`contact.phones` (**lista**). La migración corre **automática al leer**: ningún lead
existente revienta.

Además, si un `phone` viejo tenía varios números apretados en un string
(`"num1, num2, num3"`), la migración los **separa por coma** en una lista limpia.
No hay que correr ningún comando: pasa solo al cargar el lead en cualquier etapa.

---

## 8. Referencia rápida de comandos

| Comando | Qué hace | API key |
|---|---|---|
| `pnpm test` | Tests deterministas | no |
| `pnpm typecheck` | Chequeo de tipos | no |
| `pnpm cli ingest <frente> [reverso] --slug s --rubro r` | Crea el lead con las fotos | no |
| `pnpm cli extract <slug>` | Gemini llena los datos | **sí** |
| `pnpm cli verify <slug>` | Checkpoint humano interactivo | no |
| `pnpm cli build-linktree <slug>` | Genera linktree.html | no |
| `pnpm cli help` | Muestra el uso | no |

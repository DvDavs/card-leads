// app.js — SPA plana, sin build step, sin dependencias. Un screen visible a
// la vez (toggle de clase .active). Toda la logica de negocio vive en el
// server (verify-view arma el orden/labels/opciones): este archivo solo
// renderiza lo que el server manda y dispara fetch calls.

const $ = (id) => document.getElementById(id);

let currentSlug = null;

// Estado de la lista de leads (paginada + con busqueda en el server).
const listState = { page: 1, query: "", totalPages: 1 };

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function statusLabel(status) {
  const labels = {
    ingested: "Ingresado",
    extracted: "Por verificar",
    verified: "Verificado",
    linktree_built: "Cards listas",
    enriched: "Copy listo",
    web_built: "Web lista",
    deployed: "Publicado",
    proposal_ready: "Propuesta lista",
    packaged: "Empaquetado",
    error: "Error",
  };
  return labels[status] || status;
}

/* ------------------------------------------------------------------ */
/* Sesion (login/logout)                                                */
/* ------------------------------------------------------------------ */

async function checkSession() {
  const res = await fetch("/api/me", { credentials: "same-origin" }).catch(() => null);
  if (res && res.ok) {
    showScreen("screen-list");
    loadLeadsList();
  } else {
    showScreen("screen-login");
  }
}

$("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const passphrase = $("passphrase").value;
  const errorEl = $("login-error");
  const submitBtn = $("login-submit");
  errorEl.textContent = "";
  submitBtn.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    if (!res.ok) {
      errorEl.textContent = "Passphrase incorrecta.";
      return;
    }
    $("passphrase").value = "";
    showScreen("screen-list");
    loadLeadsList();
  } catch {
    errorEl.textContent = "No se pudo conectar. Reintenta.";
  } finally {
    submitBtn.disabled = false;
  }
});

$("logout-btn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  showScreen("screen-login");
});

/* ------------------------------------------------------------------ */
/* Lista de leads                                                       */
/* ------------------------------------------------------------------ */

async function loadLeadsList() {
  const countEl = $("list-count");
  const listEl = $("leads-list");
  const pagerEl = $("list-pager");
  countEl.textContent = "Cargando…";
  try {
    const params = new URLSearchParams({ page: String(listState.page) });
    if (listState.query) params.set("q", listState.query);
    const res = await fetch(`/api/leads?${params.toString()}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const items = data.items || [];
    const total = data.total ?? items.length;
    listState.page = data.page || 1;
    listState.totalPages = data.totalPages || 1;

    countEl.textContent = total === 1 ? "1 lead" : `${total} leads`;

    if (items.length === 0) {
      pagerEl.style.display = "none";
      listEl.innerHTML = listState.query
        ? `<p class="empty-hint">Sin resultados para “${esc(listState.query)}”.</p>`
        : '<p class="empty-hint">Todavia no hay leads. Toca "+ Nuevo" para empezar.</p>';
      return;
    }

    listEl.innerHTML = items
      .map(
        (l) => `
      <div class="lead-card" data-slug="${esc(l.slug)}" data-status="${esc(l.status)}">
        <div class="lead-card-main">
          <div class="lead-card-name">${esc(l.name)}</div>
          <div class="lead-card-meta">${esc(l.rubro)}</div>
        </div>
        <div class="lead-card-side">
          <span class="status-badge">${esc(statusLabel(l.status))}</span>
          <button type="button" class="lead-delete-btn" data-delete-slug="${esc(l.slug)}" data-name="${esc(l.name)}" title="Eliminar lead" aria-label="Eliminar ${esc(l.name)}">🗑</button>
        </div>
      </div>`,
      )
      .join("");
    listEl.querySelectorAll(".lead-card").forEach((el) => {
      el.addEventListener("click", (ev) => {
        // El boton de borrar vive dentro de la card: no debe abrir el lead.
        if (ev.target.closest(".lead-delete-btn")) return;
        openLead(el.dataset.slug, el.dataset.status);
      });
    });
    listEl.querySelectorAll(".lead-delete-btn").forEach((btn) => {
      btn.addEventListener("click", () => deleteLead(btn.dataset.deleteSlug, btn.dataset.name));
    });

    // Pager: solo se muestra si hay mas de una pagina.
    if (listState.totalPages > 1) {
      pagerEl.style.display = "flex";
      $("list-page-info").textContent = `Página ${listState.page} de ${listState.totalPages}`;
      $("list-prev").disabled = listState.page <= 1;
      $("list-next").disabled = listState.page >= listState.totalPages;
    } else {
      pagerEl.style.display = "none";
    }
  } catch {
    countEl.textContent = "";
    pagerEl.style.display = "none";
    listEl.innerHTML = '<p class="empty-hint">No se pudo cargar la lista.</p>';
  }
}

/**
 * Borra un lead (confirma primero). Tras borrar recarga la lista; si la pagina
 * actual quedo vacia por el borrado, el clamp del server nos trae la ultima
 * pagina valida en el proximo fetch (page se re-sincroniza con data.page).
 */
async function deleteLead(slug, name) {
  if (!slug) return false;
  const label = name || slug;
  if (!window.confirm(`¿Eliminar el lead “${label}”?\n\nSe borra su carpeta local (datos, imágenes y artefactos). Esta acción no se puede deshacer.`)) {
    return false;
  }
  try {
    const res = await fetch(`/api/leads/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    await loadLeadsList();
    return true;
  } catch (err) {
    window.alert(err.message || "No se pudo eliminar el lead.");
    return false;
  }
}

// Busqueda con debounce: cada tecla reinicia a la pagina 1.
let searchTimer = null;
$("list-search-input").addEventListener("input", (ev) => {
  const value = ev.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    listState.query = value;
    listState.page = 1;
    loadLeadsList();
  }, 250);
});

$("list-prev").addEventListener("click", () => {
  if (listState.page > 1) {
    listState.page -= 1;
    loadLeadsList();
  }
});

$("list-next").addEventListener("click", () => {
  if (listState.page < listState.totalPages) {
    listState.page += 1;
    loadLeadsList();
  }
});

// "extracted" todavia no paso el checkpoint humano -> verify. Cualquier otro
// status (verified en adelante) ya puede correr/reintentar stages -> run.
function openLead(slug, status) {
  currentSlug = slug;
  if (status === "extracted") {
    loadVerifyView(slug);
    showScreen("screen-verify");
  } else {
    setupRunScreen(slug, status);
    showScreen("screen-run");
  }
}

$("new-lead-btn").addEventListener("click", () => {
  resetCapture();
  showScreen("screen-capture");
});

/* ------------------------------------------------------------------ */
/* Captura (upload -> ingest + extract)                                 */
/*                                                                      */
/* Cada slot (front/back) acepta la imagen desde tres fuentes -- elegir */
/* archivo, arrastrar y soltar, o la camara (camera.js) -- y de forma   */
/* opcional la pasa por el recortador (cropper.js) para ajustarla al    */
/* encuadre de la tarjeta. Guardamos el File resultante en memoria y no */
/* en el <input>: el <input type=file> es read-only para 2 de esas 3    */
/* fuentes (drop y camara) y ademas la version recortada reemplaza a la */
/* original. El submit lee los archivos de aca, no del DOM.             */
/* ------------------------------------------------------------------ */

const captureFiles = { front: null, back: null };

// Refleja el estado de un slot en su caja: thumbnail + acciones, o el area
// vacia con "arrastra / elegir / tomar foto".
function renderSlot(slot) {
  const box = document.querySelector(`.uploader[data-slot="${slot}"]`);
  if (!box) return;
  const file = captureFiles[slot];
  const thumb = box.querySelector(".uploader-thumb");
  // Revoca el objectURL anterior antes de crear/soltar uno nuevo: sin esto,
  // reemplazar o quitar la foto filtraria blobs en memoria.
  if (thumb.dataset.url) {
    URL.revokeObjectURL(thumb.dataset.url);
    thumb.removeAttribute("data-url");
  }
  if (file) {
    const url = URL.createObjectURL(file);
    thumb.src = url;
    thumb.dataset.url = url;
    box.querySelector(".uploader-empty").hidden = true;
    box.querySelector(".uploader-preview").hidden = false;
  } else {
    thumb.removeAttribute("src");
    box.querySelector(".uploader-empty").hidden = false;
    box.querySelector(".uploader-preview").hidden = true;
  }
}

function setSlotFile(slot, file) {
  captureFiles[slot] = file || null;
  renderSlot(slot);
}

// Punto de convergencia de las tres fuentes: valida que sea una imagen antes
// de aceptarla en el slot.
function acceptFile(slot, file) {
  if (!file || !file.type || !file.type.startsWith("image/")) {
    $("capture-error").textContent = "El archivo debe ser una imagen.";
    return;
  }
  $("capture-error").textContent = "";
  setSlotFile(slot, file);
}

function resetCapture() {
  $("capture-form").reset();
  setSlotFile("front", null);
  setSlotFile("back", null);
  $("capture-error").textContent = "";
  $("capture-progress").style.display = "none";
}

// Conecta una caja de slot: click/arrastrar/camara/recortar/quitar. Un solo
// wiring por caja; el estado vive en captureFiles.
function initUploader(box) {
  const slot = box.dataset.slot;
  const input = box.querySelector(".uploader-input");

  box.querySelectorAll('[data-action="browse"]').forEach((b) =>
    b.addEventListener("click", () => input.click()));
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (f) acceptFile(slot, f);
    input.value = ""; // permite volver a elegir el mismo archivo
  });

  box.querySelectorAll('[data-action="camera"]').forEach((b) =>
    b.addEventListener("click", () => {
      if (window.Camera) window.Camera.open({ onCapture: (file) => acceptFile(slot, file) });
    }));

  box.querySelector('[data-action="crop"]').addEventListener("click", () => {
    const f = captureFiles[slot];
    if (f && window.Cropper) {
      window.Cropper.open({ file: f, onConfirm: (out) => setSlotFile(slot, out) });
    }
  });

  box.querySelector('[data-action="remove"]').addEventListener("click", () => setSlotFile(slot, null));

  // Arrastrar y soltar sobre toda la caja del slot.
  ["dragenter", "dragover"].forEach((type) =>
    box.addEventListener(type, (ev) => {
      ev.preventDefault();
      box.classList.add("dragover");
    }));
  ["dragleave", "dragend", "drop"].forEach((type) =>
    box.addEventListener(type, (ev) => {
      // dragleave dispara tambien al pasar sobre los hijos: solo apagamos el
      // resaltado si el puntero salio de la caja de verdad.
      if (type === "dragleave" && box.contains(ev.relatedTarget)) return;
      box.classList.remove("dragover");
    }));
  box.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) acceptFile(slot, f);
  });
}

document.querySelectorAll(".uploader").forEach(initUploader);

$("capture-cancel").addEventListener("click", () => showScreen("screen-list"));

$("capture-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const errorEl = $("capture-error");
  const submitBtn = $("capture-submit");
  const progressEl = $("capture-progress");
  errorEl.textContent = "";

  const front = captureFiles.front;
  if (!front) {
    errorEl.textContent = "Falta la foto de frente.";
    return;
  }

  const form = new FormData();
  form.set("front", front, front.name || "front.jpg");
  const back = captureFiles.back;
  if (back) form.set("back", back, back.name || "back.jpg");
  const rubro = $("rubro-input").value;
  if (rubro) form.set("rubro", rubro);

  submitBtn.disabled = true;
  progressEl.style.display = "block";
  try {
    const res = await fetch("/api/leads", { method: "POST", credentials: "same-origin", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    currentSlug = data.slug;
    await loadVerifyView(currentSlug);
    showScreen("screen-verify");
  } catch (err) {
    errorEl.textContent = err.message || "No se pudo procesar la tarjeta.";
  } finally {
    submitBtn.disabled = false;
    progressEl.style.display = "none";
  }
});

/* ------------------------------------------------------------------ */
/* Verificacion                                                         */
/* ------------------------------------------------------------------ */

function renderStringField(f) {
  const isSelect = f.kind === "enum";
  const input = isSelect
    ? `<select data-field="${esc(f.path)}" data-kind="string">
         ${(f.options || []).map((o) => `<option value="${esc(o)}" ${f.value === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
       </select>`
    : `<input type="text" data-field="${esc(f.path)}" data-kind="string" value="${esc(f.value ?? "")}" />`;
  return `
    <div class="field field-row">
      <label>${esc(f.label)}${f.risky ? ' <span class="risk-flag">⚠</span>' : ""}</label>
      <div class="field-row-inputs">
        ${input}
        ${isSelect ? "" : `<button type="button" class="clear-btn" data-clear-field="${esc(f.path)}">×</button>`}
      </div>
    </div>`;
}

function renderListField(f) {
  const value = Array.isArray(f.value) ? f.value.join("\n") : "";
  return `
    <div class="field field-row">
      <label>${esc(f.label)}${f.risky ? ' <span class="risk-flag">⚠</span>' : ""}</label>
      <textarea data-field="${esc(f.path)}" data-kind="list" rows="3">${esc(value)}</textarea>
      <p class="hint">Uno por linea.</p>
    </div>`;
}

function renderAttrField(a) {
  return `
    <div class="field field-row">
      <label>${esc(a.key)} <span class="risk-flag">⚠</span></label>
      <div class="field-row-inputs">
        <input type="text" data-field="attr:${esc(a.key)}" data-kind="string" value="${esc(a.value)}" />
        <button type="button" class="clear-btn" data-clear-field="attr:${esc(a.key)}">×</button>
      </div>
    </div>`;
}

// Normaliza un hex a "#rrggbb" estricto (6 digitos, minusculas, con "#"). El
// hex que viene del server (o el que el operador tipeo a mano en el campo de
// texto) puede no cumplir eso (vacio, con mayusculas, sin "#", o invalido: el
// server NO valida formato, ver applyCorrection/normStr en stages/verify.ts).
// Se usa para pintar el swatch disparador de la flor; si no matchea, cae a
// "#000000".
function normalizeColorInputHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  return m ? `#${m[1].toLowerCase()}` : "#000000";
}

function renderColorField(c, palette) {
  const rgbText = c.rgb ? `rgb(${c.rgb.r}, ${c.rgb.g}, ${c.rgb.b})` : "sin rgb";
  const chips = (palette || [])
    .map((hex) => `<button type="button" class="chip" style="background:${esc(hex)}" data-set-color="${esc(c.path)}" data-hex="${esc(hex)}" title="${esc(hex)}"></button>`)
    .join("");
  return `
    <div class="color-tile" style="background:${esc(c.swatch.background)}; color:${esc(c.swatch.color)};">
      <div class="color-role">${esc(c.label)}</div>
      <div class="color-detail">${esc(c.hex ?? "(sin definir)")} · ${esc(rgbText)}</div>
    </div>
    <div class="color-edit">
      <button type="button" class="blossom-trigger" data-blossom-for="${esc(c.path)}" data-label="${esc(c.label)}" style="background-color:${esc(c.hex ?? "transparent")}" aria-label="Elegir ${esc(c.label)} con selector visual"></button>
      <input type="text" data-field="${esc(c.path)}" data-kind="color" value="${esc(c.hex ?? "")}" placeholder="#rrggbb" />
      <div class="palette-chips">${chips}</div>
    </div>`;
}

async function loadVerifyView(slug) {
  $("verify-error").textContent = "";
  const res = await fetch(`/api/leads/${encodeURIComponent(slug)}/verify-view`, { credentials: "same-origin" });
  if (!res.ok) {
    $("verify-error").textContent = "No se pudo cargar el lead.";
    return;
  }
  const view = await res.json();
  renderVerifyView(view);
}

function renderVerifyView(view) {
  $("verify-subtitle").textContent = `${view.slug} · ${statusLabel(view.status)} · ${view.rubro}`;
  $("verify-phones").innerHTML = renderListField(view.phones);
  $("verify-risky").innerHTML = view.riskyFirst.map(renderStringField).join("");
  $("verify-colors").innerHTML = view.colors.map((c) => renderColorField(c, view.palette)).join("");
  $("verify-attrs").innerHTML = view.attrs.map(renderAttrField).join("");
  $("verify-general").innerHTML = view.general.map(renderStringField).join("");
  $("verify-services").innerHTML = renderListField(view.services);

  const finalizeBtn = $("verify-finalize-btn");
  finalizeBtn.textContent = view.status === "verified" ? "Ya verificado" : "Confirmar y continuar";
  finalizeBtn.disabled = view.status !== "extracted" && view.status !== "verified";
}

function readFieldValue(el) {
  const kind = el.dataset.kind;
  if (kind === "list") {
    return el.value.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  return el.value;
}

async function saveField(field, value) {
  const errorEl = $("verify-error");
  errorEl.textContent = "";
  try {
    const res = await fetch(`/api/leads/${encodeURIComponent(currentSlug)}/field`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ field, value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    // Re-cargamos la vista completa: asegura que colores recalculados
    // (textColor, colorsText) y meta.needs siempre queden consistentes con
    // lo que persistio el server, sin duplicar esa logica aca.
    await loadVerifyView(currentSlug);
  } catch (err) {
    errorEl.textContent = err.message || "No se pudo guardar el cambio.";
  }
}

// Delegacion de eventos: los inputs se regeneran en cada render, un solo
// listener por tipo de evento alcanza para todos.
document.getElementById("screen-verify").addEventListener("change", (ev) => {
  const el = ev.target;
  if (!el.dataset || !el.dataset.field) return;
  saveField(el.dataset.field, readFieldValue(el));
});

// Sync en vivo del swatch disparador de la flor mientras el operador tipea un
// hex a mano, SIN guardar (el guardado real ocurre en "change", arriba): en
// cuanto lo tipeado ES un hex valido, el swatch adopta ese color, asi el
// disparador siempre refleja el campo de texto sin disparar su propio autosave.
document.getElementById("screen-verify").addEventListener("input", (ev) => {
  const el = ev.target;
  if (!el.dataset || el.dataset.kind !== "color") return;
  const container = el.closest(".color-edit");
  if (!container) return;
  const trigger = container.querySelector(".blossom-trigger");
  if (trigger && /^#?[0-9a-f]{6}$/i.test(el.value.trim())) {
    trigger.style.backgroundColor = normalizeColorInputHex(el.value);
  }
});

document.getElementById("screen-verify").addEventListener("click", (ev) => {
  const clearField = ev.target.dataset && ev.target.dataset.clearField;
  if (clearField) {
    saveField(clearField, null);
    return;
  }
  const setColorField = ev.target.dataset && ev.target.dataset.setColor;
  if (setColorField) {
    saveField(setColorField, ev.target.dataset.hex);
    return;
  }
  // Disparador de la flor: abre el selector visual centrado en el color actual
  // del campo; al confirmar guarda por el mismo camino que el resto (saveField).
  const trigger = ev.target.closest && ev.target.closest(".blossom-trigger");
  if (trigger && window.Blossom) {
    const path = trigger.dataset.blossomFor;
    const container = trigger.closest(".color-edit");
    const hexInput = container && container.querySelector('input[data-kind="color"]');
    window.Blossom.open({
      hex: hexInput ? hexInput.value : "",
      label: trigger.dataset.label,
      onConfirm: (hex) => saveField(path, hex),
    });
  }
});

$("verify-finalize-btn").addEventListener("click", async () => {
  const errorEl = $("verify-error");
  errorEl.textContent = "";
  try {
    const res = await fetch(`/api/leads/${encodeURIComponent(currentSlug)}/finalize`, {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setupRunScreen(currentSlug, data.status);
    showScreen("screen-run");
  } catch (err) {
    errorEl.textContent = err.message || "No se pudo confirmar.";
  }
});

$("verify-back-btn").addEventListener("click", () => {
  showScreen("screen-list");
  loadLeadsList();
});

/* ------------------------------------------------------------------ */
/* Run / progreso (build-cards -> enrich -> build-web -> deploy -> package, via SSE) */
/* ------------------------------------------------------------------ */

const STAGE_ORDER = ["build-cards", "enrich", "build-web", "deploy", "package"];
const STAGE_LABELS = {
  "build-cards": "Digital cards",
  enrich: "Copy de marketing",
  "build-web": "Sitio web",
  deploy: "Publicar (deploy)",
  package: "Mensaje de contacto",
};
const STAGE_PRODUCES = {
  "build-cards": "linktree_built",
  enrich: "enriched",
  "build-web": "web_built",
  deploy: "deployed",
  package: "packaged",
};
const STATUS_ORDER = [
  "ingested", "extracted", "verified", "linktree_built", "enriched",
  "web_built", "deployed", "proposal_ready", "packaged", "error",
];

function stageDoneFor(status, stage) {
  return STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf(STAGE_PRODUCES[stage]);
}

function renderRunSteps(status) {
  $("run-steps").innerHTML = STAGE_ORDER.map(
    (stage) => `
    <div class="run-step" data-stage="${stage}">
      <span class="run-step-icon" data-icon>${stageDoneFor(status, stage) ? "✓" : "…"}</span>
      <span class="run-step-label">${esc(STAGE_LABELS[stage])}</span>
    </div>`,
  ).join("");
}

function setStepIcon(stage, icon) {
  const row = document.querySelector(`#run-steps .run-step[data-stage="${stage}"]`);
  if (row) row.querySelector("[data-icon]").textContent = icon;
}

// "Despublicar" solo tiene sentido si el lead ya esta publicado (deployed en
// adelante): antes de eso no hay carpeta remota ni link que bajar.
function isPublished(status) {
  return status !== "error" && STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf("deployed");
}

function setupRunScreen(slug, status) {
  $("run-subtitle").textContent = `${slug} · ${statusLabel(status)}`;
  $("run-error").textContent = "";
  renderRunSteps(status);
  $("run-publish-btn").textContent = status === "deployed" ? "Volver a publicar" : "Publicar";
  $("run-undeploy-btn").style.display = isPublished(status) ? "" : "none";
}

// Consume el SSE de una stage via fetch (EventSource nativo no soporta POST).
// El formato es el estandar "event: x\ndata: y\n\n"; los payloads del server
// son siempre JSON de una sola linea, asi que un split simple alcanza.
async function runStageSSE(slug, stage, onEvent) {
  const res = await fetch(`/api/leads/${encodeURIComponent(slug)}/stages/${stage}`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const evMatch = /^event: (.+)$/m.exec(chunk);
      const dataMatch = /^data: (.+)$/m.exec(chunk);
      if (!dataMatch) continue;
      let payload;
      try {
        payload = JSON.parse(dataMatch[1]);
      } catch {
        payload = dataMatch[1];
      }
      onEvent(evMatch ? evMatch[1] : "message", payload);
    }
  }
}

$("run-publish-btn").addEventListener("click", async () => {
  const btn = $("run-publish-btn");
  const errorEl = $("run-error");
  errorEl.textContent = "";
  btn.disabled = true;
  try {
    for (const stage of STAGE_ORDER) {
      setStepIcon(stage, "⏳");
      let stageError = null;
      await runStageSSE(currentSlug, stage, (event, payload) => {
        if (event === "done") setStepIcon(stage, "✓");
        else if (event === "error") {
          setStepIcon(stage, "✗");
          stageError = payload.message;
        }
      });
      if (stageError) {
        errorEl.textContent = `${STAGE_LABELS[stage]}: ${stageError}`;
        return; // no seguir con las siguientes stages si esta fallo
      }
    }
    await loadLinksScreen(currentSlug);
    showScreen("screen-links");
  } catch (err) {
    errorEl.textContent = err.message || "Fallo la publicacion.";
  } finally {
    btn.disabled = false;
  }
});

$("run-links-btn").addEventListener("click", async () => {
  await loadLinksScreen(currentSlug);
  showScreen("screen-links");
});

$("run-back-btn").addEventListener("click", () => {
  showScreen("screen-list");
  loadLeadsList();
});

// Borrar desde la pantalla de detalle: reusa deleteLead() y, solo si borro de
// verdad (usuario confirmo + server ok), vuelve a la lista. Si cancela o falla,
// nos quedamos en el detalle.
$("run-delete-btn").addEventListener("click", async () => {
  const name = $("run-subtitle").textContent.split(" · ")[0];
  if (await deleteLead(currentSlug, name)) {
    showScreen("screen-list");
  }
});

// Despublicar: baja el lead del server publico (link -> 404) sin borrar la
// carpeta local, asi se puede volver a publicar. El status regresa a
// "construido pero sin publicar", asi que refrescamos la pantalla de run.
$("run-undeploy-btn").addEventListener("click", async () => {
  const errorEl = $("run-error");
  errorEl.textContent = "";
  if (!window.confirm("¿Despublicar este lead?\n\nSe borra su carpeta del server público y deja de aparecer en el link. La carpeta local se conserva y puedes volver a publicar cuando quieras.")) {
    return;
  }
  const btn = $("run-undeploy-btn");
  btn.disabled = true;
  try {
    const res = await fetch(`/api/leads/${encodeURIComponent(currentSlug)}/undeploy`, {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setupRunScreen(currentSlug, data.status);
  } catch (err) {
    errorEl.textContent = err.message || "No se pudo despublicar.";
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* Links publicos                                                       */
/* ------------------------------------------------------------------ */

function linkRow(label, url) {
  return `
    <div class="link-row">
      <label>${esc(label)}</label>
      <div class="link-url">${esc(url)}</div>
      <div class="field-row-inputs">
        <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Abrir</a>
        <button type="button" data-copy="${esc(url)}">Copiar</button>
      </div>
    </div>`;
}

// Igual que linkRow pero para el mensaje de outreach: texto multilinea (sin
// "Abrir", no es una URL) + boton Copiar. El data-copy conserva los \n del
// mensaje; esc() solo escapa &<>"' y deja los saltos de linea intactos.
function messageRow(label, text) {
  return `
    <div class="link-row">
      <label>${esc(label)}</label>
      <div class="msg-text">${esc(text)}</div>
      <div class="field-row-inputs">
        <button type="button" data-copy="${esc(text)}">Copiar</button>
      </div>
    </div>`;
}

async function loadLinksScreen(slug) {
  const res = await fetch(`/api/leads/${encodeURIComponent(slug)}/links`, { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  const rows = [];
  if (data.dc_url) rows.push(linkRow("Digital card", data.dc_url));
  if (data.web_url) rows.push(linkRow("Sitio web", data.web_url));
  if (data.outreach_front) rows.push(messageRow("Mensaje — apertura", data.outreach_front));
  if (data.outreach_back) rows.push(messageRow("Mensaje — seguimiento", data.outreach_back));
  $("links-list").innerHTML = rows.join("") || '<p class="empty-hint">Todavia no hay links. Corre "Publicar" primero.</p>';
  $("links-list").querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(() => {
        const original = btn.textContent;
        btn.textContent = "Copiado ✓";
        setTimeout(() => { btn.textContent = original; }, 1500);
      });
    });
  });
}

$("links-back-btn").addEventListener("click", () => {
  showScreen("screen-list");
  loadLeadsList();
});

checkSession();

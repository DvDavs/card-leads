// app.js — SPA plana, sin build step, sin dependencias. Un screen visible a
// la vez (toggle de clase .active). Toda la logica de negocio vive en el
// server (verify-view arma el orden/labels/opciones): este archivo solo
// renderiza lo que el server manda y dispara fetch calls.

const $ = (id) => document.getElementById(id);

let currentSlug = null;

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
  countEl.textContent = "Cargando…";
  try {
    const res = await fetch("/api/leads", { credentials: "same-origin" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const leads = await res.json();
    countEl.textContent = leads.length === 1 ? "1 lead" : `${leads.length} leads`;
    if (leads.length === 0) {
      listEl.innerHTML = '<p class="empty-hint">Todavia no hay leads. Toca "+ Nuevo" para empezar.</p>';
      return;
    }
    listEl.innerHTML = leads
      .map(
        (l) => `
      <div class="lead-card" data-slug="${esc(l.slug)}" data-status="${esc(l.status)}">
        <div>
          <div class="lead-card-name">${esc(l.name)}</div>
          <div class="lead-card-meta">${esc(l.rubro)}</div>
        </div>
        <span class="status-badge">${esc(statusLabel(l.status))}</span>
      </div>`,
      )
      .join("");
    listEl.querySelectorAll(".lead-card").forEach((el) => {
      el.addEventListener("click", () => openLead(el.dataset.slug, el.dataset.status));
    });
  } catch {
    countEl.textContent = "";
    listEl.innerHTML = '<p class="empty-hint">No se pudo cargar la lista.</p>';
  }
}

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
  $("capture-form").reset();
  $("capture-error").textContent = "";
  $("capture-progress").style.display = "none";
  showScreen("screen-capture");
});

/* ------------------------------------------------------------------ */
/* Captura (upload -> ingest + extract)                                 */
/* ------------------------------------------------------------------ */

$("capture-cancel").addEventListener("click", () => showScreen("screen-list"));

$("capture-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const errorEl = $("capture-error");
  const submitBtn = $("capture-submit");
  const progressEl = $("capture-progress");
  errorEl.textContent = "";

  const front = $("front-input").files[0];
  if (!front) {
    errorEl.textContent = "Falta la foto de frente.";
    return;
  }

  const form = new FormData();
  form.set("front", front);
  const back = $("back-input").files[0];
  if (back) form.set("back", back);
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

document.getElementById("screen-verify").addEventListener("click", (ev) => {
  const clearField = ev.target.dataset && ev.target.dataset.clearField;
  if (clearField) {
    saveField(clearField, null);
    return;
  }
  const setColorField = ev.target.dataset && ev.target.dataset.setColor;
  if (setColorField) {
    saveField(setColorField, ev.target.dataset.hex);
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
/* Run / progreso (build-cards -> enrich -> build-web -> deploy, via SSE) */
/* ------------------------------------------------------------------ */

const STAGE_ORDER = ["build-cards", "enrich", "build-web", "deploy"];
const STAGE_LABELS = {
  "build-cards": "Digital cards",
  enrich: "Copy de marketing",
  "build-web": "Sitio web",
  deploy: "Publicar (deploy)",
};
const STAGE_PRODUCES = {
  "build-cards": "linktree_built",
  enrich: "enriched",
  "build-web": "web_built",
  deploy: "deployed",
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

function setupRunScreen(slug, status) {
  $("run-subtitle").textContent = `${slug} · ${statusLabel(status)}`;
  $("run-error").textContent = "";
  renderRunSteps(status);
  $("run-publish-btn").textContent = status === "deployed" ? "Volver a publicar" : "Publicar";
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

async function loadLinksScreen(slug) {
  const res = await fetch(`/api/leads/${encodeURIComponent(slug)}/links`, { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  const rows = [];
  if (data.dc_url) rows.push(linkRow("Digital card", data.dc_url));
  if (data.web_url) rows.push(linkRow("Sitio web", data.web_url));
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

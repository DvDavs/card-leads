// cropper.js — recortador de imagenes para ajustar la foto al encuadre de la
// tarjeta. Abre un overlay con la imagen y una caja de recorte que se mueve
// (arrastrando el centro) y se redimensiona (por las esquinas). Puede fijar la
// proporcion de una tarjeta de presentacion estandar (1.75:1) o dejar el
// recorte libre, y girar la foto de a 90° (util cuando la tarjeta salio de
// lado). Al aplicar dibuja la region elegida a resolucion completa y devuelve
// un File JPEG via onConfirm(file). Sin dependencias ni build step: mismo
// patron que blossom.js -- un overlay unico reutilizable.
//
// Se abre con Cropper.open({ file, onConfirm }). Toda la geometria del recorte
// se maneja en "px de pantalla" sobre el lienzo mostrado; al aplicar se escala
// de vuelta a la resolucion real del bitmap (dispScale) para no perder calidad.
(function () {
  "use strict";

  const CARD_ASPECT = 3.5 / 2; // tarjeta de presentacion estandar (1.75:1)
  const MIN_CROP = 40; // lado minimo de la caja, en px de pantalla
  const maxW = () => Math.min(560, window.innerWidth - 40);
  const maxH = () => Math.min(520, window.innerHeight - 240);

  let dom = null;
  let onConfirm = null;
  let source = null; // ImageBitmap | HTMLImageElement (orientacion EXIF ya aplicada)
  let work = null; // canvas con la fuente ya rotada: la referencia real para recortar
  let rotation = 0; // 0 | 90 | 180 | 270
  let workW = 0, workH = 0; // dimensiones del bitmap rotado (px reales)
  let dispScale = 1; // px reales -> px de pantalla
  let dispW = 0, dispH = 0; // tamaño del lienzo mostrado
  let aspect = CARD_ASPECT; // null = libre
  let crop = { x: 0, y: 0, w: 0, h: 0 }; // px de pantalla, relativo al lienzo
  let drag = null;

  function clamp(n, a, b) {
    return Math.min(b, Math.max(a, n));
  }

  function buildDom() {
    const overlay = document.createElement("div");
    overlay.className = "capture-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.hidden = true;

    const panel = document.createElement("div");
    panel.className = "capture-panel cropper-panel";

    const title = document.createElement("div");
    title.className = "capture-title";
    title.textContent = "Recortar";

    // Controles: proporcion (tarjeta / libre) + girar.
    const controls = document.createElement("div");
    controls.className = "cropper-controls";
    const cardBtn = document.createElement("button");
    cardBtn.type = "button";
    cardBtn.className = "cropper-tool";
    cardBtn.dataset.aspect = "card";
    cardBtn.textContent = "Tarjeta";
    const freeBtn = document.createElement("button");
    freeBtn.type = "button";
    freeBtn.className = "cropper-tool";
    freeBtn.dataset.aspect = "free";
    freeBtn.textContent = "Libre";
    const rotateBtn = document.createElement("button");
    rotateBtn.type = "button";
    rotateBtn.className = "cropper-tool";
    rotateBtn.textContent = "⟳ Girar";
    controls.appendChild(cardBtn);
    controls.appendChild(freeBtn);
    controls.appendChild(rotateBtn);

    const stage = document.createElement("div");
    stage.className = "cropper-stage";
    const canvas = document.createElement("canvas");
    canvas.className = "cropper-canvas";
    const boxEl = document.createElement("div");
    boxEl.className = "cropper-box";
    ["nw", "ne", "sw", "se"].forEach((h) => {
      const handle = document.createElement("div");
      handle.className = "cropper-handle cropper-handle-" + h;
      handle.dataset.handle = h;
      boxEl.appendChild(handle);
    });
    stage.appendChild(canvas);
    stage.appendChild(boxEl);

    const errorEl = document.createElement("div");
    errorEl.className = "capture-error";

    const footer = document.createElement("div");
    footer.className = "capture-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "capture-btn";
    cancelBtn.textContent = "Cancelar";
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "capture-btn primary";
    applyBtn.textContent = "Aplicar recorte";
    footer.appendChild(cancelBtn);
    footer.appendChild(applyBtn);

    panel.appendChild(title);
    panel.appendChild(controls);
    panel.appendChild(stage);
    panel.appendChild(errorEl);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    dom = { overlay, panel, title, stage, canvas, boxEl, errorEl, cardBtn, freeBtn, rotateBtn, cancelBtn, applyBtn };
    wireEvents();
  }

  function wireEvents() {
    dom.cardBtn.addEventListener("click", () => {
      aspect = CARD_ASPECT;
      defaultCrop();
      positionBox();
      updateTools();
    });
    dom.freeBtn.addEventListener("click", () => {
      aspect = null;
      defaultCrop();
      positionBox();
      updateTools();
    });
    dom.rotateBtn.addEventListener("click", () => {
      rotation = (rotation + 90) % 360;
      drawWork();
      defaultCrop();
      positionBox();
    });

    dom.cancelBtn.addEventListener("click", () => close());
    dom.applyBtn.addEventListener("click", () => apply());
    dom.overlay.addEventListener("pointerdown", (ev) => {
      if (ev.target === dom.overlay) close();
    });
    window.addEventListener("keydown", (ev) => {
      if (dom.overlay.hidden) return;
      if (ev.key === "Escape") close();
    });

    // Arrastre de la caja / esquinas.
    dom.boxEl.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      const p = stagePoint(ev);
      const handle = ev.target.dataset && ev.target.dataset.handle;
      if (handle) {
        drag = { mode: "resize", anchor: anchorFor(handle) };
      } else {
        drag = { mode: "move", startX: p.x, startY: p.y, orig: { x: crop.x, y: crop.y } };
      }
      dom.boxEl.setPointerCapture?.(ev.pointerId);
    });
    dom.boxEl.addEventListener("pointermove", (ev) => {
      if (drag) onDrag(stagePoint(ev));
    });
    window.addEventListener("pointerup", () => { drag = null; });
  }

  // Punto del puntero relativo al lienzo (el stage no se escala: dispW/dispH
  // son px reales de pantalla, asi que no hace falta factor de correccion).
  function stagePoint(ev) {
    const r = dom.stage.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  // Esquina opuesta (fija) a la que se arrastra: el anclaje al redimensionar.
  function anchorFor(handle) {
    const { x, y, w, h } = crop;
    if (handle === "nw") return { x: x + w, y: y + h };
    if (handle === "ne") return { x: x, y: y + h };
    if (handle === "sw") return { x: x + w, y: y };
    return { x: x, y: y }; // se
  }

  function onDrag(p) {
    const px = clamp(p.x, 0, dispW);
    const py = clamp(p.y, 0, dispH);
    if (drag.mode === "move") {
      const nx = clamp(drag.orig.x + (p.x - drag.startX), 0, dispW - crop.w);
      const ny = clamp(drag.orig.y + (p.y - drag.startY), 0, dispH - crop.h);
      crop.x = nx;
      crop.y = ny;
    } else {
      const a = drag.anchor;
      const dirX = px >= a.x ? 1 : -1;
      const dirY = py >= a.y ? 1 : -1;
      let w = Math.abs(px - a.x);
      let h = Math.abs(py - a.y);
      if (aspect) {
        // Deriva la altura del ancho manteniendo la proporcion, y recorta al
        // borde de la imagen segun el lado hacia el que se arrastra.
        h = w / aspect;
        const maxWDir = dirX > 0 ? dispW - a.x : a.x;
        const maxHDir = dirY > 0 ? dispH - a.y : a.y;
        if (w > maxWDir) { w = maxWDir; h = w / aspect; }
        if (h > maxHDir) { h = maxHDir; w = h * aspect; }
        if (w < MIN_CROP) { w = MIN_CROP; h = w / aspect; }
      } else {
        w = Math.max(MIN_CROP, w);
        h = Math.max(MIN_CROP, h);
      }
      crop.x = dirX > 0 ? a.x : a.x - w;
      crop.y = dirY > 0 ? a.y : a.y - h;
      crop.w = w;
      crop.h = h;
    }
    positionBox();
  }

  async function loadSource(file) {
    // createImageBitmap con imageOrientation aplica la orientacion EXIF (evita
    // que las fotos de celular salgan de costado). Si no esta disponible, cae a
    // un <img>, que los navegadores modernos tambien orientan por defecto.
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        /* fallback abajo */
      }
    }
    return await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img load")); };
      img.src = url;
    });
  }

  // Rende­riza la fuente rotada a un canvas "work" de resolucion completa (la
  // referencia para el recorte final) y lo pinta escalado en el lienzo visible.
  function drawWork() {
    const sw = source.width || source.naturalWidth;
    const sh = source.height || source.naturalHeight;
    if (rotation === 90 || rotation === 270) { workW = sh; workH = sw; }
    else { workW = sw; workH = sh; }

    work = document.createElement("canvas");
    work.width = workW;
    work.height = workH;
    const wctx = work.getContext("2d");
    wctx.translate(workW / 2, workH / 2);
    wctx.rotate((rotation * Math.PI) / 180);
    wctx.drawImage(source, -sw / 2, -sh / 2);

    dispScale = Math.min(maxW() / workW, maxH() / workH);
    dispW = Math.max(1, Math.round(workW * dispScale));
    dispH = Math.max(1, Math.round(workH * dispScale));
    dom.canvas.width = dispW;
    dom.canvas.height = dispH;
    dom.canvas.getContext("2d").drawImage(work, 0, 0, dispW, dispH);
    dom.stage.style.width = dispW + "px";
    dom.stage.style.height = dispH + "px";
  }

  // Caja inicial: maxima centrada. Con proporcion fija, la ajusta a la tarjeta;
  // libre, cubre toda la imagen.
  function defaultCrop() {
    if (aspect) {
      let w = dispW;
      let h = w / aspect;
      if (h > dispH) { h = dispH; w = h * aspect; }
      crop = { x: (dispW - w) / 2, y: (dispH - h) / 2, w, h };
    } else {
      crop = { x: 0, y: 0, w: dispW, h: dispH };
    }
  }

  function positionBox() {
    dom.boxEl.style.left = crop.x + "px";
    dom.boxEl.style.top = crop.y + "px";
    dom.boxEl.style.width = crop.w + "px";
    dom.boxEl.style.height = crop.h + "px";
  }

  function updateTools() {
    dom.cardBtn.classList.toggle("active", aspect === CARD_ASPECT);
    dom.freeBtn.classList.toggle("active", aspect === null);
  }

  // Recorta sobre "work" (resolucion completa) escalando la caja de pantalla de
  // vuelta a px reales, y entrega el resultado como File JPEG.
  function apply() {
    const sx = crop.x / dispScale;
    const sy = crop.y / dispScale;
    const sw = crop.w / dispScale;
    const sh = crop.h / dispScale;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(sw));
    out.height = Math.max(1, Math.round(sh));
    out.getContext("2d").drawImage(work, sx, sy, sw, sh, 0, 0, out.width, out.height);
    out.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], "recorte.jpg", { type: "image/jpeg" });
        const cb = onConfirm;
        close();
        if (cb) cb(file);
      },
      "image/jpeg",
      0.92,
    );
  }

  async function open(opts) {
    if (!dom) buildDom();
    onConfirm = opts && opts.onConfirm;
    rotation = 0;
    aspect = CARD_ASPECT;
    crop = { x: 0, y: 0, w: 0, h: 0 };
    dom.errorEl.textContent = "";
    dom.boxEl.hidden = true;
    dom.overlay.hidden = false;
    void dom.overlay.offsetWidth;
    dom.overlay.classList.add("open");
    try {
      source = await loadSource(opts.file);
    } catch {
      dom.errorEl.textContent = "No se pudo cargar la imagen.";
      return;
    }
    drawWork();
    defaultCrop();
    positionBox();
    updateTools();
    dom.boxEl.hidden = false;
  }

  function close() {
    if (!dom || dom.overlay.hidden) return;
    if (source && source.close) source.close(); // libera el ImageBitmap
    source = null;
    work = null;
    onConfirm = null;
    drag = null;
    dom.overlay.classList.remove("open");
    dom.overlay.hidden = true;
  }

  window.Cropper = { open };
})();

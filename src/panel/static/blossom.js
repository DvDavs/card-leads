// blossom.js — selector de color "flor" (Blossom) para la pantalla de verify.
//
// Reemplaza al swatch nativo <input type="color"> como picker VISUAL: un
// overlay que "florece" desde el centro con petalos de colores FIJOS en dos
// anillos concentricos (multicapa) y un arc slider que ajusta el tono/sombra
// del color elegido. Inspirado en BlossomColorPicker (dayflow-js), reescrito
// en JS puro sin dependencias ni build step, para encajar en el panel vanilla.
//
// No sabe nada del negocio: se abre con Blossom.open({ hex, label, onConfirm }).
// El commit lo decide el que abre (onConfirm(hex)); cancelar no llama nada. El
// campo de texto hex y los chips de la paleta medida siguen aparte, en app.js.
(function () {
  "use strict";

  // --- Geometria de la flor (px, relativa al centro del contenedor) ---
  const BOX = 340; // lado del contenedor cuadrado
  const CX = BOX / 2;
  const CY = BOX / 2;
  const ARC_R = 150; // radio del arc slider
  const ARC_A0 = 160; // angulo (deg, y-abajo) del extremo t=0 (claro)
  const ARC_A1 = 20; //  angulo del extremo t=1 (oscuro); pasa por 90 (abajo)

  // Petalos: dos anillos concentricos de tonos FIJOS. El anillo interno lleva
  // 6 tonos base; el externo 12 en los "valles", para que la flor se vea llena.
  const RINGS = [
    { r: 60, size: 48, hues: [0, 60, 120, 180, 240, 300] },
    { r: 104, size: 42, hues: [15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345] },
  ];

  // --- Utilidades de color (puras) ---
  function clamp(n, a, b) {
    return Math.min(b, Math.max(a, n));
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
  }
  function hslToHex(h, s, l) {
    const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
    return rgbToHex(r, g, b);
  }
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, s, l];
  }
  // Color final a partir de tono (hue) y posicion del slider t (0..1):
  // t=0 -> muy claro, t=0.5 -> tono vivido, t=1 -> muy oscuro. En los extremos
  // baja la saturacion, asi el slider tambien alcanza neutros (casi blanco /
  // casi negro), utiles para los roles background/surface/text.
  function shadeHex(hue, t) {
    const l = 0.92 - t * 0.84;
    const s = 0.8 * (1 - Math.pow(Math.abs(2 * t - 1), 1.7));
    return hslToHex(hue, s, l);
  }
  // Color "vivido" de cada petalo (el swatch que se ve en la flor).
  function petalHex(hue) {
    return hslToHex(hue, 0.72, 0.55);
  }
  // Deriva (tono, t) del petalo/slider mas cercano a un hex dado, para abrir la
  // flor ya posicionada sobre el color actual del campo.
  function nearestState(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return { hue: 0, t: 0.5 };
    const [h, , l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    let best = RINGS[0].hues[0], bestD = Infinity;
    for (const ring of RINGS) {
      for (const hue of ring.hues) {
        const d = Math.min(Math.abs(hue - h), 360 - Math.abs(hue - h));
        if (d < bestD) { bestD = d; best = hue; }
      }
    }
    return { hue: best, t: clamp((0.92 - l) / 0.84, 0, 1) };
  }
  function deg2rad(d) {
    return (d * Math.PI) / 180;
  }

  // --- DOM: overlay unico, se construye una sola vez y se reutiliza ---
  let dom = null;
  const state = { hue: 0, t: 0.5, onConfirm: null, dragging: false };

  function buildDom() {
    const overlay = document.createElement("div");
    overlay.className = "blossom-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.hidden = true;

    const panel = document.createElement("div");
    panel.className = "blossom-panel";

    const title = document.createElement("div");
    title.className = "blossom-title";

    const stage = document.createElement("div");
    stage.className = "blossom-stage";
    stage.style.width = BOX + "px";
    stage.style.height = BOX + "px";

    // Arc slider (SVG): track con gradiente claro->oscuro del tono actual + handle.
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "blossom-arc");
    svg.setAttribute("viewBox", `0 0 ${BOX} ${BOX}`);
    const grad = document.createElementNS(svgNS, "linearGradient");
    grad.id = "blossom-arc-grad";
    grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "1"); grad.setAttribute("y2", "0");
    const stop0 = document.createElementNS(svgNS, "stop");
    stop0.setAttribute("offset", "0%");
    const stop1 = document.createElementNS(svgNS, "stop");
    stop1.setAttribute("offset", "100%");
    grad.appendChild(stop0); grad.appendChild(stop1);
    const defs = document.createElementNS(svgNS, "defs");
    defs.appendChild(grad);
    const trackBg = document.createElementNS(svgNS, "path");
    trackBg.setAttribute("class", "blossom-arc-bg");
    trackBg.setAttribute("d", arcPath());
    const track = document.createElementNS(svgNS, "path");
    track.setAttribute("class", "blossom-arc-track");
    track.setAttribute("d", arcPath());
    track.setAttribute("stroke", "url(#blossom-arc-grad)");
    // Zona de tap ANCHA e invisible sobre el arco: el track visible es fino
    // (10px) y en mobile es dificil de acertar; este path transparente de 40px
    // captura el toque en cualquier punto de la banda del slider.
    const hit = document.createElementNS(svgNS, "path");
    hit.setAttribute("class", "blossom-arc-hit");
    hit.setAttribute("d", arcPath());
    svg.appendChild(defs);
    svg.appendChild(trackBg);
    svg.appendChild(track);
    svg.appendChild(hit);

    const handle = document.createElement("div");
    handle.className = "blossom-arc-handle";

    // Core central: preview del color elegido + confirmar al tocarlo.
    const core = document.createElement("button");
    core.type = "button";
    core.className = "blossom-core";
    core.setAttribute("aria-label", "Usar este color");
    core.innerHTML = '<span class="blossom-core-check">✓</span>';

    const petals = document.createElement("div");
    petals.className = "blossom-petals";

    stage.appendChild(svg);
    stage.appendChild(petals);
    stage.appendChild(handle);
    stage.appendChild(core);

    const footer = document.createElement("div");
    footer.className = "blossom-footer";
    const swatch = document.createElement("span");
    swatch.className = "blossom-swatch";
    const hexLabel = document.createElement("span");
    hexLabel.className = "blossom-hex";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "blossom-btn";
    cancelBtn.textContent = "Cancelar";
    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "blossom-btn primary";
    useBtn.textContent = "Usar color";
    footer.appendChild(swatch);
    footer.appendChild(hexLabel);
    footer.appendChild(cancelBtn);
    footer.appendChild(useBtn);

    panel.appendChild(title);
    panel.appendChild(stage);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Petalos: uno por tono, guardan su tono en dataset.
    const petalEls = [];
    let idx = 0;
    for (const ring of RINGS) {
      const n = ring.hues.length;
      for (let i = 0; i < n; i++) {
        const hue = ring.hues[i];
        const ang = -90 + (i * 360) / n; // arranca arriba
        const px = CX + ring.r * Math.cos(deg2rad(ang));
        const py = CY + ring.r * Math.sin(deg2rad(ang));
        const el = document.createElement("button");
        el.type = "button";
        el.className = "blossom-petal";
        el.style.width = el.style.height = ring.size + "px";
        el.style.left = px - ring.size / 2 + "px";
        el.style.top = py - ring.size / 2 + "px";
        el.style.background = petalHex(hue);
        // Desplazamiento al centro, para colapsar/florecer desde ahi.
        el.style.setProperty("--dx", CX - px + "px");
        el.style.setProperty("--dy", CY - py + "px");
        el.style.setProperty("--delay", idx * 16 + "ms");
        el.dataset.hue = String(hue);
        petals.appendChild(el);
        petalEls.push(el);
        idx++;
      }
    }

    dom = { overlay, panel, title, stage, svg, track, hit, handle, core, petals, petalEls, swatch, hexLabel, stop0, stop1, cancelBtn, useBtn };
    wireEvents();
  }

  // Path SVG del arco (de A0 a A1 pasando por abajo).
  function arcPath() {
    const p0 = arcPoint(0);
    const p1 = arcPoint(1);
    // sweep-flag 0: sentido antihorario en coords y-abajo -> pasa por el fondo.
    return `M ${p0.x} ${p0.y} A ${ARC_R} ${ARC_R} 0 0 0 ${p1.x} ${p1.y}`;
  }
  function arcPoint(t) {
    const ang = ARC_A0 + (ARC_A1 - ARC_A0) * t;
    return { x: CX + ARC_R * Math.cos(deg2rad(ang)), y: CY + ARC_R * Math.sin(deg2rad(ang)) };
  }
  // De un punto (relativo al stage) al t mas cercano sobre el arco.
  function pointToT(x, y) {
    let ang = (Math.atan2(y - CY, x - CX) * 180) / Math.PI;
    if (ang < 0) ang += 360;
    // El arco vive entre A1(20) y A0(160); fuera de rango, clamp al extremo mas cercano.
    const lo = Math.min(ARC_A0, ARC_A1), hi = Math.max(ARC_A0, ARC_A1);
    ang = clamp(ang, lo, hi);
    return clamp((ARC_A0 - ang) / (ARC_A0 - ARC_A1), 0, 1);
  }

  function render() {
    const hex = shadeHex(state.hue, state.t);
    // Core + footer.
    dom.core.style.background = hex;
    dom.core.style.color = state.t > 0.55 ? "#fff" : "#111";
    dom.swatch.style.background = hex;
    dom.hexLabel.textContent = hex;
    // Handle sobre el arco.
    const p = arcPoint(state.t);
    dom.handle.style.left = p.x + "px";
    dom.handle.style.top = p.y + "px";
    dom.handle.style.background = hex;
    // Gradiente del track segun tono actual.
    dom.stop0.setAttribute("stop-color", shadeHex(state.hue, 0.12));
    dom.stop1.setAttribute("stop-color", shadeHex(state.hue, 0.88));
    // Petalo seleccionado.
    for (const el of dom.petalEls) {
      el.classList.toggle("selected", Number(el.dataset.hue) === state.hue);
    }
  }

  function wireEvents() {
    // Elegir tono con un petalo.
    dom.petals.addEventListener("click", (ev) => {
      const el = ev.target.closest(".blossom-petal");
      if (!el) return;
      state.hue = Number(el.dataset.hue);
      render();
    });

    // Arc slider: arrastrar el handle o tocar el arco.
    function updateFromEvent(ev) {
      const rect = dom.stage.getBoundingClientRect();
      const scale = BOX / rect.width; // el stage se escala en pantallas chicas
      const x = (ev.clientX - rect.left) * scale;
      const y = (ev.clientY - rect.top) * scale;
      state.t = pointToT(x, y);
      render();
    }
    function startDrag(ev) {
      state.dragging = true;
      dom.handle.setPointerCapture?.(ev.pointerId);
      updateFromEvent(ev);
    }
    dom.handle.addEventListener("pointerdown", (ev) => { ev.preventDefault(); startDrag(ev); });
    dom.hit.addEventListener("pointerdown", (ev) => { ev.preventDefault(); startDrag(ev); });
    dom.handle.addEventListener("pointermove", (ev) => { if (state.dragging) updateFromEvent(ev); });
    dom.stage.addEventListener("pointermove", (ev) => { if (state.dragging) updateFromEvent(ev); });
    window.addEventListener("pointerup", () => { state.dragging = false; });

    // Confirmar / cancelar.
    dom.core.addEventListener("click", () => close(true));
    dom.useBtn.addEventListener("click", () => close(true));
    dom.cancelBtn.addEventListener("click", () => close(false));
    dom.overlay.addEventListener("pointerdown", (ev) => {
      if (ev.target === dom.overlay) close(false);
    });
    window.addEventListener("keydown", (ev) => {
      if (dom.overlay.hidden) return;
      if (ev.key === "Escape") close(false);
      else if (ev.key === "Enter") close(true);
    });
  }

  function open(opts) {
    if (!dom) buildDom();
    const start = nearestState(opts && opts.hex);
    state.hue = start.hue;
    state.t = start.t;
    state.onConfirm = opts && opts.onConfirm;
    dom.title.textContent = (opts && opts.label) || "Elegir color";
    render();
    dom.overlay.hidden = false;
    // Fuerza reflow antes de florecer, asi la transicion corre desde el estado
    // colapsado (los petalos arrancan en el centro) hacia su posicion final.
    void dom.overlay.offsetWidth;
    dom.overlay.classList.add("blooming");
  }

  function close(commit) {
    if (!dom || dom.overlay.hidden) return;
    if (commit && state.onConfirm) state.onConfirm(shadeHex(state.hue, state.t));
    state.onConfirm = null;
    dom.overlay.classList.remove("blooming");
    // Espera a que los petalos se recojan antes de ocultar el overlay.
    setTimeout(() => { if (!dom.overlay.classList.contains("blooming")) dom.overlay.hidden = true; }, 280);
  }

  window.Blossom = { open, shadeHex, petalHex };
})();

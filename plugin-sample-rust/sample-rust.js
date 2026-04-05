const params = new URLSearchParams(window.location.search);
const clientIdInput = document.getElementById("client-id");
const messageInput = document.getElementById("message");
const logEl = document.getElementById("log");
const sendBtn = document.getElementById("send-btn");
const pingBtn = document.getElementById("ping-btn");
const statsBtn = document.getElementById("stats-btn");

const pluginId = "sample-rust";
clientIdInput.value = params.get("clientId") || "";
messageInput.value = "hello from sample-rust UI";

function log(line) {
  const ts = new Date().toISOString();
  logEl.textContent = `${ts} ${line}\n` + logEl.textContent;
}

async function sendEvent(event, payload) {
  const clientId = clientIdInput.value.trim();
  if (!clientId) { log("Missing clientId"); return; }
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/plugins/${pluginId}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, payload }),
  });
  if (!res.ok) { log(`Send failed: ${res.status} ${await res.text()}`); return; }
  log(`Sent event: ${event}`);
}

sendBtn.addEventListener("click", () => {
  sendEvent("ui_message", { message: messageInput.value.trim() });
});

pingBtn.addEventListener("click", () => {
  sendEvent("ping", {});
});

statsBtn.addEventListener("click", () => {
  sendEvent("stats", {});
});

if (typeof EventSource !== "undefined") {
  const clientId = params.get("clientId");
  if (clientId) {
    log("Ready — Rust plugin (fully unloadable)");
  }
}

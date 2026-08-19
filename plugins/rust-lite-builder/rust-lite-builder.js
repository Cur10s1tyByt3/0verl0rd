const statusOutput = document.getElementById("rust-lite-status");
const refreshButton = document.getElementById("rust-lite-refresh");

async function refreshStatus() {
  statusOutput.textContent = "Checking Rust Lite builder...";
  try {
    const response = await fetch("/api/plugins/rust-lite-builder/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "status", params: {} }),
    });
    const body = await response.json();
    if (!body.ok) throw new Error(body.error || "Status check failed");
    statusOutput.textContent = JSON.stringify(body.result, null, 2);
  } catch (error) {
    statusOutput.textContent = `Error: ${error?.message || error}`;
  }
}

refreshButton?.addEventListener("click", refreshStatus);
refreshStatus();

(() => {
  const board = document.getElementById("c4-board");
  if (!board || board.dataset.ready === "true") return;
  board.dataset.ready = "true";

  const columnsElement = document.getElementById("c4-columns");
  const statusElement = document.getElementById("c4-status");
  const turnElement = document.getElementById("c4-turn");
  const playerRElement = document.getElementById("c4-player-r");
  const playerYElement = document.getElementById("c4-player-y");
  const challengesElement = document.getElementById("c4-challenges");
  const emptyElement = document.getElementById("c4-empty");
  const newButton = document.getElementById("c4-new");
  const refreshButton = document.getElementById("c4-refresh");
  const lobbyElement = document.querySelector(".c4-lobby");
  const clientId = new URLSearchParams(window.location.search).get("clientId")?.trim() || "";
  const directClientMode = Boolean(clientId);
  if (directClientMode) {
    lobbyElement.hidden = true;
    newButton.textContent = "New match";
    const subtitle = document.querySelector(".c4-subtitle");
    if (subtitle) subtitle.textContent = `Playing against ${clientId}.`;
  }

  let currentGame = null;
  let celebratedGame = "";
  let busy = false;
  const cells = [];
  const dropButtons = [];

  async function rpc(method, params = {}) {
    const response = await fetch("/api/plugins/connect-four/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) throw new Error(body.error || response.statusText);
    return body.result;
  }

  async function syncClient(game) {
    if (!directClientMode || !game) return;
    const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/plugins/connect-four/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "state", payload: game }),
    });
    if (!response.ok) throw new Error(`Client sync failed: ${response.statusText}`);
  }

  function celebrateWinner(game) {
    const celebrationId = game?.status === "won" && game.winner === game.yourColor
      ? `${game.id}:${game.winner}`
      : "";
    if (!celebrationId || celebrationId === celebratedGame) return;
    celebratedGame = celebrationId;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = game.winner === "R"
      ? ["#ef4444", "#fca5a5", "#ffffff"]
      : ["#facc15", "#fef08a", "#ffffff"];
    const layer = document.createElement("div");
    layer.className = "c4-confetti";
    layer.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 72; index += 1) {
      const piece = document.createElement("i");
      piece.style.left = `${(index * 37) % 100}%`;
      piece.style.background = colors[index % colors.length];
      piece.style.animationDelay = `${(index % 12) * 35}ms`;
      piece.style.animationDuration = `${900 + (index % 7) * 90}ms`;
      layer.append(piece);
    }
    document.body.append(layer);
    window.setTimeout(() => layer.remove(), 1800);
  }

  function createBoard() {
    const controls = document.createDocumentFragment();
    for (let column = 0; column < 7; column += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "c4-drop";
      button.dataset.column = String(column);
      button.textContent = "▼";
      button.setAttribute("aria-label", `Drop in column ${column + 1}`);
      dropButtons.push(button);
      controls.append(button);
    }
    columnsElement.append(controls);

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 42; index += 1) {
      const cell = document.createElement("div");
      const disc = document.createElement("span");
      cell.className = "c4-cell";
      cell.dataset.column = String(index % 7);
      cell.setAttribute("aria-label", `Drop in column ${(index % 7) + 1}`);
      cell.setAttribute("role", "gridcell");
      disc.className = "c4-disc";
      cell.append(disc);
      cells.push(disc);
      fragment.append(cell);
    }
    board.append(fragment);
  }

  function renderGame(game) {
    currentGame = game || null;
    const values = game?.board || Array(42).fill("");
    const canMove = game?.status === "active" && game.yourColor === game.turn;
    cells.forEach((disc, index) => {
      const color = values[index];
      disc.className = `c4-disc${color === "R" ? " red" : color === "Y" ? " yellow" : ""}`;
      disc.parentElement.classList.toggle("full-column", Boolean(values[index % 7]));
    });
    dropButtons.forEach((button, column) => {
      button.disabled = !canMove || Boolean(values[column]);
    });
    board.classList.toggle("can-drop", canMove);

    playerRElement.textContent = `Red · ${game?.playerR?.username || "Waiting"}`;
    playerYElement.textContent = `Yellow · ${game?.playerY?.username || "Waiting"}`;
    if (!game) {
      turnElement.textContent = "No active match";
      statusElement.textContent = "Create or accept a challenge to play.";
      return;
    }
    turnElement.textContent = game.message;
    if (game.status === "open") statusElement.textContent = "Challenge created. Waiting for another user.";
    else if (game.status === "active") statusElement.textContent = canMove ? `Your turn as ${game.yourColor === "R" ? "Red" : "Yellow"}.` : "Waiting for your opponent.";
    else if (game.status === "won") statusElement.textContent = game.winner === game.yourColor ? "You won." : "You lost.";
    else statusElement.textContent = "The match ended in a draw.";
    celebrateWinner(game);
  }

  function renderChallenges(challenges) {
    challengesElement.replaceChildren();
    const rows = Array.isArray(challenges) ? challenges : [];
    emptyElement.hidden = rows.length > 0;
    for (const challenge of rows) {
      const row = document.createElement("div");
      const label = document.createElement("span");
      row.className = "c4-challenge";
      label.textContent = `${challenge.username} · ${challenge.role}`;
      row.append(label);
      if (challenge.canAccept) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Accept";
        button.addEventListener("click", () => void acceptChallenge(challenge.id));
        row.append(button);
      } else {
        const waiting = document.createElement("span");
        waiting.textContent = "Your challenge";
        row.append(waiting);
      }
      challengesElement.append(row);
    }
  }

  async function refresh() {
    try {
      const result = await rpc("snapshot", { gameId: currentGame?.id });
      renderGame(result.game);
      renderChallenges(result.challenges);
      if (directClientMode && result.game) await syncClient(result.game);
    } catch (error) {
      statusElement.textContent = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function startClientMatch() {
    if (busy) return;
    busy = true;
    newButton.disabled = true;
    try {
      const result = await rpc("startClientMatch", { clientId, clientName: clientId });
      renderGame(result.game);
      await syncClient(result.game);
    } catch (error) {
      statusElement.textContent = `Could not start client match: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
      newButton.disabled = false;
    }
  }

  async function createChallenge() {
    if (busy) return;
    busy = true;
    newButton.disabled = true;
    try {
      const result = await rpc("createChallenge");
      renderGame(result.game);
      await refresh();
    } catch (error) {
      statusElement.textContent = `Could not create challenge: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
      newButton.disabled = false;
    }
  }

  async function acceptChallenge(gameId) {
    if (busy) return;
    busy = true;
    try {
      const result = await rpc("acceptChallenge", { gameId });
      renderGame(result.game);
      await refresh();
    } catch (error) {
      statusElement.textContent = `Could not accept challenge: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
    }
  }

  async function drop(column) {
    if (busy || !currentGame) return;
    busy = true;
    try {
      const result = await rpc("move", { gameId: currentGame.id, column });
      renderGame(result.game);
      await syncClient(result.game);
    } catch (error) {
      statusElement.textContent = `Move rejected: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
    }
  }

  columnsElement.addEventListener("click", (event) => {
    const button = event.target.closest(".c4-drop");
    if (button) void drop(Number(button.dataset.column));
  });
  board.addEventListener("click", (event) => {
    const cell = event.target.closest(".c4-cell");
    if (!cell || !currentGame || currentGame.status !== "active" || currentGame.yourColor !== currentGame.turn) return;
    const column = Number(cell.dataset.column);
    if (!currentGame.board?.[column]) void drop(column);
  });
  newButton.addEventListener("click", () => void (directClientMode ? startClientMatch() : createChallenge()));
  refreshButton.addEventListener("click", () => void refresh());

  try {
    const stream = new EventSource("/api/plugins/connect-four/stream");
    stream.addEventListener("changed", () => void refresh());
  } catch {}

  createBoard();
  void (directClientMode ? startClientMatch() : refresh());
})();

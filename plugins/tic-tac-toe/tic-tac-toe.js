(() => {
  const board = document.getElementById("ttt-board");
  if (!board || board.dataset.ready === "true") return;
  board.dataset.ready = "true";

  const statusElement = document.getElementById("ttt-status");
  const turnElement = document.getElementById("ttt-turn");
  const playerXElement = document.getElementById("ttt-player-x");
  const playerOElement = document.getElementById("ttt-player-o");
  const challengesElement = document.getElementById("ttt-challenges");
  const emptyElement = document.getElementById("ttt-empty");
  const newButton = document.getElementById("ttt-new");
  const refreshButton = document.getElementById("ttt-refresh");
  const lobbyElement = document.querySelector(".ttt-lobby");
  const clientId = new URLSearchParams(window.location.search).get("clientId")?.trim() || "";
  const directClientMode = Boolean(clientId);
  if (directClientMode) {
    lobbyElement.hidden = true;
    newButton.textContent = "New match";
    const subtitle = document.querySelector(".ttt-subtitle");
    if (subtitle) subtitle.textContent = `Playing against ${clientId}.`;
  }

  let celebratedGame = "";
  let currentGame = null;
  let busy = false;
  const cells = [];

  async function rpc(method, params = {}) {
    const response = await fetch("/api/plugins/tic-tac-toe/rpc", {
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
    const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/plugins/tic-tac-toe/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "state", payload: game }),
    });
    if (!response.ok) throw new Error(`Client sync failed: ${response.statusText}`);
  }

  function celebrateWinner(game) {
    const celebrationId = game?.status === "won" && game.winner === game.yourMark
      ? `${game.id}:${game.winner}`
      : "";
    if (!celebrationId || celebrationId === celebratedGame) return;
    celebratedGame = celebrationId;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = game.winner === "X"
      ? ["#38bdf8", "#bae6fd", "#ffffff"]
      : ["#fb7185", "#fecdd3", "#ffffff"];
    const layer = document.createElement("div");
    layer.className = "ttt-confetti";
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
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 9; index += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "ttt-cell";
      cell.dataset.cell = String(index);
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", `Cell ${index + 1}`);
      cells.push(cell);
      fragment.append(cell);
    }
    board.append(fragment);
  }

  function renderGame(game) {
    currentGame = game || null;
    const values = game?.board || Array(9).fill("");
    const canMove = game?.status === "active" && game.yourMark === game.turn;
    cells.forEach((cell, index) => {
      const mark = values[index] || "";
      cell.textContent = mark;
      cell.className = `ttt-cell${mark ? ` mark-${mark.toLowerCase()}` : ""}`;
      cell.disabled = !canMove || Boolean(mark);
    });

    playerXElement.textContent = `X · ${game?.playerX?.username || "Waiting"}`;
    playerOElement.textContent = `O · ${game?.playerO?.username || "Waiting"}`;
    if (!game) {
      turnElement.textContent = "No active match";
      statusElement.textContent = "Create or accept a challenge to play.";
      return;
    }
    turnElement.textContent = game.message;
    if (game.status === "open") statusElement.textContent = "Challenge created. Waiting for another user.";
    else if (game.status === "active") statusElement.textContent = canMove ? `Your turn as ${game.yourMark}.` : `Waiting for ${game.turn}.`;
    else if (game.status === "won") statusElement.textContent = game.winner === game.yourMark ? "You won." : "You lost.";
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
      row.className = "ttt-challenge";
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

  async function makeMove(cell) {
    if (busy || !currentGame) return;
    busy = true;
    try {
      const result = await rpc("move", { gameId: currentGame.id, cell });
      renderGame(result.game);
      await syncClient(result.game);
    } catch (error) {
      statusElement.textContent = `Move rejected: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
    }
  }

  board.addEventListener("click", (event) => {
    const cell = event.target.closest(".ttt-cell");
    if (cell) void makeMove(Number(cell.dataset.cell));
  });
  newButton.addEventListener("click", () => void (directClientMode ? startClientMatch() : createChallenge()));
  refreshButton.addEventListener("click", () => void refresh());

  try {
    const stream = new EventSource("/api/plugins/tic-tac-toe/stream");
    stream.addEventListener("changed", () => void refresh());
  } catch {}

  createBoard();
  void (directClientMode ? startClientMatch() : refresh());
})();

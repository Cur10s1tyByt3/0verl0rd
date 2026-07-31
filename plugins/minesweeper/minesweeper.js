(() => {
  const board = document.getElementById("mine-board");
  if (!board || board.dataset.ready === "true") return;
  board.dataset.ready = "true";

  const difficultySelect = document.getElementById("mine-difficulty");
  const newGameButton = document.getElementById("mine-new-game");
  const refreshButton = document.getElementById("mine-refresh");
  const mineCount = document.getElementById("mine-count");
  const timeElement = document.getElementById("mine-time");
  const statusElement = document.getElementById("mine-status");
  const leaderboardList = document.getElementById("mine-leaderboard-list");
  const leaderboardEmpty = document.getElementById("mine-leaderboard-empty");

  let game = null;
  let timer = null;
  let busy = false;

  async function rpc(method, params = {}) {
    const response = await fetch("/api/plugins/minesweeper/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) throw new Error(body.error || response.statusText);
    return body.result;
  }

  function setStatus(message) {
    statusElement.textContent = message;
  }

  function formatTime(milliseconds) {
    return `${(Math.max(0, Number(milliseconds) || 0) / 1000).toFixed(1)}s`;
  }

  function updateClock() {
    if (!game?.startedAt || game.status !== "playing") return;
    timeElement.textContent = String(Math.floor((Date.now() - game.startedAt) / 1000));
  }

  function renderLeaderboard(entries) {
    leaderboardList.replaceChildren();
    const safeEntries = Array.isArray(entries) ? entries : [];
    leaderboardEmpty.hidden = safeEntries.length > 0;
    safeEntries.forEach((entry, index) => {
      const item = document.createElement("li");
      const rank = document.createElement("span");
      const player = document.createElement("span");
      const result = document.createElement("strong");
      const moves = document.createElement("small");
      rank.className = "mine-rank";
      player.className = "mine-player";
      result.className = "mine-result";
      rank.textContent = String(index + 1).padStart(2, "0");
      player.textContent = String(entry.player || "Player");
      result.textContent = formatTime(entry.timeMs);
      moves.textContent = `${Number(entry.moves) || 0} moves`;
      result.append(moves);
      item.append(rank, player, result);
      leaderboardList.append(item);
    });
  }

  async function loadLeaderboard() {
    try {
      const result = await rpc("leaderboard", { difficulty: difficultySelect.value });
      renderLeaderboard(result.entries);
    } catch (error) {
      setStatus(`Leaderboard unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function updateMineCounter() {
    if (!game) return;
    mineCount.textContent = String(Math.max(0, game.mines - game.flags.size));
  }

  function buildBoard() {
    board.replaceChildren();
    board.style.gridTemplateColumns = `repeat(${game.width}, var(--cell-size))`;
    board.style.setProperty("--cell-size", game.width >= 30 ? "25px" : game.width >= 16 ? "28px" : "34px");
    const fragment = document.createDocumentFragment();
    game.cells = [];
    for (let y = 0; y < game.height; y += 1) {
      for (let x = 0; x < game.width; x += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "mine-cell";
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `Hidden cell ${x + 1}, ${y + 1}`);
        game.cells.push(cell);
        fragment.append(cell);
      }
    }
    board.append(fragment);
  }

  function renderCells(cells, hit) {
    for (const data of Array.isArray(cells) ? cells : []) {
      const index = Number(data.y) * game.width + Number(data.x);
      const cell = game.cells[index];
      if (!cell) continue;
      game.revealed.add(index);
      game.flags.delete(index);
      cell.className = "mine-cell revealed";
      cell.disabled = true;
      if (data.mine) {
        const isHit = hit && Number(hit.x) === Number(data.x) && Number(hit.y) === Number(data.y);
        cell.classList.add(isHit ? "mine-hit" : "mine-shown");
        cell.textContent = "*";
        cell.setAttribute("aria-label", isHit ? "Triggered mine" : "Mine");
      } else {
        const value = Number(data.value) || 0;
        if (value) {
          cell.classList.add(`value-${value}`);
          cell.textContent = String(value);
        } else {
          cell.textContent = "";
        }
        cell.setAttribute("aria-label", value ? `${value} adjacent mines` : "Clear cell");
      }
    }
    updateMineCounter();
  }

  function finish(status, elapsedMs, entries) {
    game.status = status;
    clearInterval(timer);
    timer = null;
    timeElement.textContent = String(Math.floor(elapsedMs / 1000));
    for (const cell of game.cells) cell.disabled = true;
    if (status === "won") {
      setStatus(`Field cleared in ${formatTime(elapsedMs)}.`);
      if (entries) renderLeaderboard(entries);
    } else {
      setStatus("Mine triggered. Start a new game to try again.");
    }
  }

  async function reveal(x, y) {
    if (!game || game.status !== "playing" || busy) return;
    const index = y * game.width + x;
    if (game.flags.has(index) || game.revealed.has(index)) return;
    busy = true;
    if (!game.startedAt) {
      game.startedAt = Date.now();
      timer = setInterval(updateClock, 250);
    }
    try {
      const result = await rpc("reveal", { gameId: game.id, x, y });
      game.startedAt = Date.now() - Number(result.elapsedMs || 0);
      renderCells(result.cells, result.hit);
      if (result.status === "won" || result.status === "lost") {
        finish(result.status, Number(result.elapsedMs || 0), result.entries);
      } else {
        setStatus(`${Number(result.moves) || 0} moves.`);
      }
    } catch (error) {
      setStatus(`Reveal failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false;
    }
  }

  function toggleFlag(x, y) {
    if (!game || game.status !== "playing" || busy) return;
    const index = y * game.width + x;
    if (game.revealed.has(index)) return;
    const cell = game.cells[index];
    if (game.flags.has(index)) {
      game.flags.delete(index);
      cell.classList.remove("flagged");
      cell.textContent = "";
      cell.setAttribute("aria-label", `Hidden cell ${x + 1}, ${y + 1}`);
    } else if (game.flags.size < game.mines) {
      game.flags.add(index);
      cell.classList.add("flagged");
      cell.textContent = "!";
      cell.setAttribute("aria-label", `Flagged cell ${x + 1}, ${y + 1}`);
    }
    updateMineCounter();
  }

  async function startGame() {
    newGameButton.disabled = true;
    clearInterval(timer);
    timer = null;
    setStatus("Creating a server game…");
    try {
      const session = await rpc("start", { difficulty: difficultySelect.value });
      game = {
        id: session.gameId,
        difficulty: session.difficulty,
        width: Number(session.width),
        height: Number(session.height),
        mines: Number(session.mines),
        cells: [],
        flags: new Set(),
        revealed: new Set(),
        status: "playing",
        startedAt: 0,
      };
      mineCount.textContent = String(game.mines);
      timeElement.textContent = "0";
      buildBoard();
      setStatus("Game ready. The first cell is always safe.");
      await loadLeaderboard();
    } catch (error) {
      setStatus(`Could not start: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      newGameButton.disabled = false;
    }
  }

  board.addEventListener("click", (event) => {
    const cell = event.target.closest(".mine-cell");
    if (!cell) return;
    void reveal(Number(cell.dataset.x), Number(cell.dataset.y));
  });
  board.addEventListener("contextmenu", (event) => {
    const cell = event.target.closest(".mine-cell");
    if (!cell) return;
    event.preventDefault();
    toggleFlag(Number(cell.dataset.x), Number(cell.dataset.y));
  });
  newGameButton.addEventListener("click", () => void startGame());
  difficultySelect.addEventListener("change", () => void startGame());
  refreshButton.addEventListener("click", () => void loadLeaderboard());

  try {
    const stream = new EventSource("/api/plugins/minesweeper/stream");
    stream.addEventListener("leaderboard", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.difficulty === difficultySelect.value) renderLeaderboard(payload.entries);
      } catch {}
    });
  } catch {}

  void startGame();
})();

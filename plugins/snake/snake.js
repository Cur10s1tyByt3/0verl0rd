(() => {
  const board = document.getElementById("snake-board");
  if (!(board instanceof HTMLCanvasElement) || board.dataset.ready === "true") return;
  board.dataset.ready = "true";

  const context = board.getContext("2d");
  const scoreElement = document.getElementById("snake-score");
  const bestElement = document.getElementById("snake-best");
  const statusElement = document.getElementById("snake-status");
  const overlay = document.getElementById("snake-overlay");
  const overlayTitle = document.getElementById("snake-overlay-title");
  const overlayCopy = document.getElementById("snake-overlay-copy");
  const startButton = document.getElementById("snake-start");
  const refreshButton = document.getElementById("snake-refresh");
  const leaderboardList = document.getElementById("snake-leaderboard-list");
  const leaderboardEmpty = document.getElementById("snake-leaderboard-empty");

  const directions = {
    up: { x: 0, y: -1, opposite: "down" },
    down: { x: 0, y: 1, opposite: "up" },
    left: { x: -1, y: 0, opposite: "right" },
    right: { x: 1, y: 0, opposite: "left" },
  };
  const keyDirections = {
    ArrowUp: "up", KeyW: "up",
    ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
  };

  let game = null;
  let timer = null;
  let pendingDirection = null;
  let paused = false;
  let best = 0;

  function makeRng(seed) {
    let value = seed >>> 0;
    return () => {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      return (value >>> 0) / 0x100000000;
    };
  }

  function chooseFood(snake, rng, size) {
    const occupied = new Set(snake.map((cell) => `${cell.x},${cell.y}`));
    const free = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!occupied.has(`${x},${y}`)) free.push({ x, y });
      }
    }
    return free.length ? free[Math.floor(rng() * free.length)] : null;
  }

  async function rpc(method, params = {}) {
    const response = await fetch("/api/plugins/snake/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) throw new Error(body.error || response.statusText);
    return body.result;
  }

  function setStatus(message) {
    if (statusElement) statusElement.textContent = message;
  }

  function setOverlay(title, copy, buttonLabel) {
    if (overlayTitle) overlayTitle.textContent = title;
    if (overlayCopy) overlayCopy.textContent = copy;
    if (startButton) startButton.textContent = buttonLabel;
    if (overlay) overlay.hidden = false;
  }

  function renderLeaderboard(entries) {
    if (!leaderboardList || !leaderboardEmpty) return;
    leaderboardList.replaceChildren();
    const safeEntries = Array.isArray(entries) ? entries : [];
    leaderboardEmpty.hidden = safeEntries.length > 0;
    safeEntries.forEach((entry, index) => {
      const item = document.createElement("li");
      const rank = document.createElement("span");
      const player = document.createElement("span");
      const points = document.createElement("strong");
      rank.className = "snake-rank";
      player.className = "snake-player";
      points.className = "snake-points";
      rank.textContent = String(index + 1).padStart(2, "0");
      player.textContent = String(entry.player || "Player");
      points.textContent = String(Number(entry.score) || 0);
      item.append(rank, player, points);
      leaderboardList.append(item);
    });
    best = safeEntries.reduce((maximum, entry) => Math.max(maximum, Number(entry.score) || 0), 0);
    if (bestElement) bestElement.textContent = String(best);
  }

  async function loadLeaderboard() {
    try {
      const result = await rpc("leaderboard");
      renderLeaderboard(result.entries);
    } catch (error) {
      setStatus(`Leaderboard unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function draw() {
    if (!context) return;
    const size = game?.size || 24;
    const cell = board.width / size;
    context.fillStyle = "#07100d";
    context.fillRect(0, 0, board.width, board.height);

    context.strokeStyle = "rgba(94, 227, 142, 0.055)";
    context.lineWidth = 1;
    for (let i = 1; i < size; i += 1) {
      const offset = Math.round(i * cell) + 0.5;
      context.beginPath(); context.moveTo(offset, 0); context.lineTo(offset, board.height); context.stroke();
      context.beginPath(); context.moveTo(0, offset); context.lineTo(board.width, offset); context.stroke();
    }
    if (!game) return;

    if (game.food) {
      const inset = 3;
      context.fillStyle = "#ef4444";
      context.fillRect(game.food.x * cell + inset, game.food.y * cell + inset, cell - inset * 2, cell - inset * 2);
    }

    game.snake.forEach((segment) => {
      const inset = 2;
      context.fillStyle = "#22c55e";
      context.fillRect(segment.x * cell + inset, segment.y * cell + inset, cell - inset * 2, cell - inset * 2);
    });
  }

  function queueDirection(direction) {
    if (!game || game.ended || paused || pendingDirection || !directions[direction]) return;
    if (directions[game.direction].opposite === direction) return;
    if (direction !== game.direction) pendingDirection = direction;
  }

  async function finish(won) {
    if (!game || game.ended) return;
    game.ended = true;
    clearInterval(timer);
    timer = null;
    setStatus("Validating run with the server…");
    try {
      const result = await rpc("submit", { gameId: game.id, ticks: game.tick, moves: game.moves });
      renderLeaderboard(result.entries);
      setOverlay(won ? "Board cleared" : "Game over", `Validated score: ${result.score}`, "Play again");
      setStatus("Run validated and leaderboard updated.");
    } catch (error) {
      setOverlay("Run rejected", error instanceof Error ? error.message : String(error), "Try again");
      setStatus("The server could not validate this run.");
    }
  }

  function tick() {
    if (!game || game.ended || paused) return;
    game.tick += 1;
    if (pendingDirection) {
      game.direction = pendingDirection;
      game.moves.push({ tick: game.tick, direction: pendingDirection });
      pendingDirection = null;
    }

    const vector = directions[game.direction];
    const head = { x: game.snake[0].x + vector.x, y: game.snake[0].y + vector.y };
    const ate = game.food && head.x === game.food.x && head.y === game.food.y;
    const collisionBody = ate ? game.snake : game.snake.slice(0, -1);
    const collided = head.x < 0 || head.y < 0 || head.x >= game.size || head.y >= game.size ||
      collisionBody.some((cell) => cell.x === head.x && cell.y === head.y);
    if (collided) {
      draw();
      void finish(false);
      return;
    }

    game.snake.unshift(head);
    if (ate) {
      game.score += 1;
      game.food = chooseFood(game.snake, game.rng, game.size);
      if (scoreElement) scoreElement.textContent = String(game.score);
      if (!game.food) {
        draw();
        void finish(true);
        return;
      }
    } else {
      game.snake.pop();
    }
    draw();
  }

  async function startGame() {
    if (startButton) startButton.disabled = true;
    setStatus("Opening a validated game session…");
    try {
      const session = await rpc("start");
      const rng = makeRng(Number(session.seed));
      const snake = session.snake.map((cell) => ({ x: Number(cell.x), y: Number(cell.y) }));
      chooseFood(snake, rng, Number(session.boardSize));
      game = {
        id: session.gameId,
        size: Number(session.boardSize),
        snake,
        food: session.food,
        direction: session.direction,
        score: 0,
        tick: 0,
        moves: [],
        rng,
        ended: false,
      };
      paused = false;
      pendingDirection = null;
      if (scoreElement) scoreElement.textContent = "0";
      if (overlay) overlay.hidden = true;
      clearInterval(timer);
      timer = setInterval(tick, Number(session.tickMs) || 115);
      setStatus("Game active.");
      draw();
    } catch (error) {
      setOverlay("Could not start", error instanceof Error ? error.message : String(error), "Retry");
      setStatus("Could not open a game session.");
    } finally {
      if (startButton) startButton.disabled = false;
    }
  }

  function togglePause() {
    if (!game || game.ended) return;
    paused = !paused;
    if (paused) {
      setOverlay("Paused", "Press Space to continue.", "Resume");
      setStatus("Game paused.");
    } else {
      if (overlay) overlay.hidden = true;
      setStatus("Game active.");
    }
  }

  document.addEventListener("keydown", (event) => {
    const direction = keyDirections[event.code];
    if (direction) {
      event.preventDefault();
      queueDirection(direction);
    } else if (event.code === "Space" && game && !game.ended) {
      event.preventDefault();
      togglePause();
    }
  });
  document.querySelectorAll(".snake-controls [data-direction]").forEach((button) => {
    button.addEventListener("click", () => queueDirection(button.dataset.direction));
  });
  startButton?.addEventListener("click", () => {
    if (paused && game && !game.ended) togglePause();
    else void startGame();
  });
  refreshButton?.addEventListener("click", () => void loadLeaderboard());

  try {
    const stream = new EventSource("/api/plugins/snake/stream");
    stream.addEventListener("leaderboard", (event) => {
      try { renderLeaderboard(JSON.parse(event.data).entries); } catch {}
    });
  } catch {}

  draw();
  void loadLeaderboard();
})();

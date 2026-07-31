const BOARD_SIZE = 24;
const MAX_TICKS = 100_000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const DIRECTIONS = {
  up: { x: 0, y: -1, opposite: "down" },
  down: { x: 0, y: 1, opposite: "up" },
  left: { x: -1, y: 0, opposite: "right" },
  right: { x: 1, y: 0, opposite: "left" },
};

function makeRng(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x100000000;
  };
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function chooseFood(snake, rng) {
  const occupied = new Set(snake.map(cellKey));
  const free = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  return free.length ? free[Math.floor(rng() * free.length)] : null;
}

function initialState(seed) {
  const snake = [{ x: 12, y: 12 }, { x: 11, y: 12 }, { x: 10, y: 12 }];
  const rng = makeRng(seed);
  return { snake, direction: "right", food: chooseFood(snake, rng), score: 0, rng };
}

function step(state) {
  const vector = DIRECTIONS[state.direction];
  const head = { x: state.snake[0].x + vector.x, y: state.snake[0].y + vector.y };
  const ate = state.food && head.x === state.food.x && head.y === state.food.y;
  const collisionBody = ate ? state.snake : state.snake.slice(0, -1);
  const collided = head.x < 0 || head.y < 0 || head.x >= BOARD_SIZE || head.y >= BOARD_SIZE ||
    collisionBody.some((cell) => cell.x === head.x && cell.y === head.y);
  if (collided) return { dead: true, won: false };

  state.snake.unshift(head);
  if (ate) {
    state.score += 1;
    state.food = chooseFood(state.snake, state.rng);
    if (!state.food) return { dead: true, won: true };
  } else {
    state.snake.pop();
  }
  return { dead: false, won: false };
}

function validateMoves(value, ticks) {
  if (!Array.isArray(value) || value.length > ticks) throw new Error("Invalid move log");
  let lastTick = 0;
  return value.map((move) => {
    const tick = Number(move?.tick);
    const direction = move?.direction;
    if (!Number.isInteger(tick) || tick <= lastTick || tick > ticks || !DIRECTIONS[direction]) {
      throw new Error("Invalid move log");
    }
    lastTick = tick;
    return { tick, direction };
  });
}

function replay(seed, ticks, moves) {
  const state = initialState(seed);
  let moveIndex = 0;
  for (let tick = 1; tick <= ticks; tick += 1) {
    if (moveIndex < moves.length && moves[moveIndex].tick === tick) {
      const next = moves[moveIndex].direction;
      if (DIRECTIONS[state.direction].opposite === next) throw new Error("Invalid direction change");
      state.direction = next;
      moveIndex += 1;
    }
    const outcome = step(state);
    if (outcome.dead) {
      if (tick !== ticks) throw new Error("Run continued after game over");
      return { score: state.score, won: outcome.won };
    }
  }
  throw new Error("Run has not ended");
}

function leaderboard(ctx) {
  return ctx.db.prepare(`
    SELECT caller_id AS callerId, username, score, played_at AS playedAt
    FROM snake_scores
    ORDER BY score DESC, played_at ASC
    LIMIT 10
  `).all().map((row) => ({
    player: String(row.username || `Player #${row.callerId}`),
    score: Number(row.score),
    playedAt: Number(row.playedAt),
  }));
}

export default {
  setup(ctx) {
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS snake_games (
        id TEXT PRIMARY KEY,
        caller_id INTEGER NOT NULL,
        seed INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS snake_scores (
        caller_id INTEGER PRIMARY KEY,
        username TEXT,
        score INTEGER NOT NULL,
        played_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS snake_games_created_at ON snake_games(created_at);
    `);
    const scoreColumns = ctx.db.prepare("PRAGMA table_info(snake_scores)").all();
    if (!scoreColumns.some((column) => column.name === "username")) {
      ctx.db.exec("ALTER TABLE snake_scores ADD COLUMN username TEXT");
    }
    ctx.db.prepare("DELETE FROM snake_games WHERE created_at < ?").run(Date.now() - SESSION_TTL_MS);
    ctx.log.info("Snake arcade ready");
  },

  rpc: {
    start(ctx, _params, meta) {
      const callerId = Number(meta.caller.id);
      const id = crypto.randomUUID();
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      const createdAt = Date.now();
      ctx.db.prepare("DELETE FROM snake_games WHERE caller_id = ? AND completed = 0").run(callerId);
      ctx.db.prepare("INSERT INTO snake_games (id, caller_id, seed, created_at) VALUES (?, ?, ?, ?)")
        .run(id, callerId, seed, createdAt);
      const state = initialState(seed);
      return {
        gameId: id,
        seed,
        boardSize: BOARD_SIZE,
        snake: state.snake,
        food: state.food,
        direction: state.direction,
        tickMs: 115,
      };
    },

    leaderboard(ctx, _params, meta) {
      const username = String(meta.caller.username || `Player #${meta.caller.id}`).trim();
      ctx.db.prepare("UPDATE snake_scores SET username = ? WHERE caller_id = ?")
        .run(username, Number(meta.caller.id));
      return { entries: leaderboard(ctx) };
    },

    submit(ctx, params, meta) {
      const gameId = typeof params?.gameId === "string" ? params.gameId : "";
      const ticks = Number(params?.ticks);
      if (!gameId || !Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS) {
        throw new Error("Invalid completed run");
      }

      const game = ctx.db.prepare(
        "SELECT id, caller_id AS callerId, seed, created_at AS createdAt, completed FROM snake_games WHERE id = ?",
      ).get(gameId);
      if (!game || Number(game.callerId) !== Number(meta.caller.id)) throw new Error("Game not found");
      if (game.completed) throw new Error("Game was already submitted");
      if (Date.now() - Number(game.createdAt) > SESSION_TTL_MS) throw new Error("Game expired");

      const moves = validateMoves(params?.moves, ticks);
      const result = replay(Number(game.seed), ticks, moves);
      const username = String(meta.caller.username || `Player #${meta.caller.id}`).trim();
      const playedAt = Date.now();
      const save = ctx.db.transaction(() => {
        const updated = ctx.db.prepare("UPDATE snake_games SET completed = 1 WHERE id = ? AND completed = 0").run(gameId);
        if (updated.changes !== 1) throw new Error("Game was already submitted");
        ctx.db.prepare("UPDATE snake_scores SET username = ? WHERE caller_id = ?")
          .run(username, Number(meta.caller.id));
        ctx.db.prepare(`
          INSERT INTO snake_scores (caller_id, username, score, played_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(caller_id) DO UPDATE SET
            score = excluded.score,
            played_at = excluded.played_at
          WHERE excluded.score > snake_scores.score
        `).run(Number(meta.caller.id), username, result.score, playedAt);
      });
      save();

      const entries = leaderboard(ctx);
      ctx.broadcast("leaderboard", { entries });
      return { score: result.score, won: result.won, entries };
    },
  },
};

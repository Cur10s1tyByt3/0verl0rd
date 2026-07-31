const DIFFICULTIES = {
  beginner: { width: 9, height: 9, mines: 10 },
  intermediate: { width: 16, height: 16, mines: 40 },
  expert: { width: 30, height: 16, mines: 99 },
};
const GAME_TTL_MS = 24 * 60 * 60 * 1000;

function parseSet(json) {
  try {
    const values = JSON.parse(json || "[]");
    return new Set(Array.isArray(values) ? values.map(Number).filter(Number.isInteger) : []);
  } catch {
    return new Set();
  }
}

function adjacent(index, width, height) {
  const x = index % width;
  const y = Math.floor(index / width);
  const result = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) result.push(ny * width + nx);
    }
  }
  return result;
}

function generateMines(width, height, mineCount, firstIndex) {
  const excluded = new Set([firstIndex, ...adjacent(firstIndex, width, height)]);
  const candidates = [];
  for (let index = 0; index < width * height; index += 1) {
    if (!excluded.has(index)) candidates.push(index);
  }
  const random = crypto.getRandomValues(new Uint32Array(candidates.length));
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = random[index] % (index + 1);
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
  }
  return new Set(candidates.slice(0, mineCount));
}

function cellValue(index, mines, width, height) {
  let count = 0;
  for (const neighbor of adjacent(index, width, height)) {
    if (mines.has(neighbor)) count += 1;
  }
  return count;
}

function revealArea(firstIndex, revealed, mines, width, height) {
  const pending = [firstIndex];
  while (pending.length) {
    const index = pending.pop();
    if (revealed.has(index) || mines.has(index)) continue;
    revealed.add(index);
    if (cellValue(index, mines, width, height) !== 0) continue;
    for (const neighbor of adjacent(index, width, height)) {
      if (!revealed.has(neighbor) && !mines.has(neighbor)) pending.push(neighbor);
    }
  }
}

function visibleCells(revealed, mines, width, height, showMines) {
  const cells = [];
  for (const index of revealed) {
    cells.push({
      x: index % width,
      y: Math.floor(index / width),
      value: cellValue(index, mines, width, height),
    });
  }
  if (showMines) {
    for (const index of mines) {
      cells.push({ x: index % width, y: Math.floor(index / width), mine: true });
    }
  }
  return cells;
}

function leaderboard(ctx, difficulty) {
  return ctx.db.prepare(`
    SELECT caller_id AS callerId, username, time_ms AS timeMs, moves, played_at AS playedAt
    FROM minesweeper_scores
    WHERE difficulty = ?
    ORDER BY time_ms ASC, moves ASC, played_at ASC
    LIMIT 10
  `).all(difficulty).map((row) => ({
    player: String(row.username || `Player #${row.callerId}`),
    timeMs: Number(row.timeMs),
    moves: Number(row.moves),
    playedAt: Number(row.playedAt),
  }));
}

function getDifficulty(value) {
  const key = typeof value === "string" ? value : "beginner";
  if (!DIFFICULTIES[key]) throw new Error("Unknown difficulty");
  return { key, ...DIFFICULTIES[key] };
}

export default {
  setup(ctx) {
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS minesweeper_games (
        id TEXT PRIMARY KEY,
        caller_id INTEGER NOT NULL,
        difficulty TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        mine_count INTEGER NOT NULL,
        mines_json TEXT,
        revealed_json TEXT NOT NULL DEFAULT '[]',
        moves INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS minesweeper_scores (
        caller_id INTEGER NOT NULL,
        username TEXT,
        difficulty TEXT NOT NULL,
        time_ms INTEGER NOT NULL,
        moves INTEGER NOT NULL,
        played_at INTEGER NOT NULL,
        PRIMARY KEY (caller_id, difficulty)
      );
      CREATE INDEX IF NOT EXISTS minesweeper_games_created_at ON minesweeper_games(created_at);
    `);
    const scoreColumns = ctx.db.prepare("PRAGMA table_info(minesweeper_scores)").all();
    if (!scoreColumns.some((column) => column.name === "username")) {
      ctx.db.exec("ALTER TABLE minesweeper_scores ADD COLUMN username TEXT");
    }
    ctx.db.prepare("DELETE FROM minesweeper_games WHERE created_at < ?").run(Date.now() - GAME_TTL_MS);
    ctx.log.info("Minesweeper ready");
  },

  rpc: {
    start(ctx, params, meta) {
      const difficulty = getDifficulty(params?.difficulty);
      const callerId = Number(meta.caller.id);
      const gameId = crypto.randomUUID();
      ctx.db.prepare("DELETE FROM minesweeper_games WHERE caller_id = ? AND finished = 0").run(callerId);
      ctx.db.prepare(`
        INSERT INTO minesweeper_games
          (id, caller_id, difficulty, width, height, mine_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(gameId, callerId, difficulty.key, difficulty.width, difficulty.height, difficulty.mines, Date.now());
      return {
        gameId,
        difficulty: difficulty.key,
        width: difficulty.width,
        height: difficulty.height,
        mines: difficulty.mines,
      };
    },

    leaderboard(ctx, params, meta) {
      const difficulty = getDifficulty(params?.difficulty);
      const username = String(meta.caller.username || `Player #${meta.caller.id}`).trim();
      ctx.db.prepare("UPDATE minesweeper_scores SET username = ? WHERE caller_id = ? AND difficulty = ?")
        .run(username, Number(meta.caller.id), difficulty.key);
      return { difficulty: difficulty.key, entries: leaderboard(ctx, difficulty.key) };
    },

    reveal(ctx, params, meta) {
      const gameId = typeof params?.gameId === "string" ? params.gameId : "";
      const x = Number(params?.x);
      const y = Number(params?.y);
      const game = ctx.db.prepare(`
        SELECT id, caller_id AS callerId, difficulty, width, height,
          mine_count AS mineCount, mines_json AS minesJson,
          revealed_json AS revealedJson, moves, started_at AS startedAt, finished
        FROM minesweeper_games WHERE id = ?
      `).get(gameId);
      if (!game || Number(game.callerId) !== Number(meta.caller.id)) throw new Error("Game not found");
      if (Number(game.finished) !== 0) throw new Error("Game is already finished");

      const width = Number(game.width);
      const height = Number(game.height);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
        throw new Error("Invalid cell");
      }

      const index = y * width + x;
      const revealed = parseSet(game.revealedJson);
      let mines = game.minesJson ? parseSet(game.minesJson) : null;
      const startedAt = game.startedAt ? Number(game.startedAt) : Date.now();
      if (!mines) mines = generateMines(width, height, Number(game.mineCount), index);

      if (revealed.has(index)) {
        return {
          status: "playing",
          cells: visibleCells(revealed, mines, width, height, false),
          moves: Number(game.moves),
          elapsedMs: Date.now() - startedAt,
        };
      }

      const moves = Number(game.moves) + 1;
      if (mines.has(index)) {
        ctx.db.prepare(`
          UPDATE minesweeper_games
          SET mines_json = ?, started_at = ?, moves = ?, finished = 2
          WHERE id = ?
        `).run(JSON.stringify([...mines]), startedAt, moves, gameId);
        return {
          status: "lost",
          cells: visibleCells(revealed, mines, width, height, true),
          hit: { x, y },
          moves,
          elapsedMs: Date.now() - startedAt,
        };
      }

      revealArea(index, revealed, mines, width, height);
      const won = revealed.size === width * height - Number(game.mineCount);
      const elapsedMs = Date.now() - startedAt;
      ctx.db.prepare(`
        UPDATE minesweeper_games
        SET mines_json = ?, revealed_json = ?, started_at = ?, moves = ?, finished = ?
        WHERE id = ?
      `).run(JSON.stringify([...mines]), JSON.stringify([...revealed]), startedAt, moves, won ? 1 : 0, gameId);

      let entries;
      if (won) {
        const playedAt = Date.now();
        const username = String(meta.caller.username || `Player #${meta.caller.id}`).trim();
        ctx.db.prepare("UPDATE minesweeper_scores SET username = ? WHERE caller_id = ? AND difficulty = ?")
          .run(username, Number(meta.caller.id), game.difficulty);
        ctx.db.prepare(`
          INSERT INTO minesweeper_scores (caller_id, username, difficulty, time_ms, moves, played_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(caller_id, difficulty) DO UPDATE SET
            time_ms = excluded.time_ms,
            moves = excluded.moves,
            played_at = excluded.played_at
          WHERE excluded.time_ms < minesweeper_scores.time_ms
             OR (excluded.time_ms = minesweeper_scores.time_ms AND excluded.moves < minesweeper_scores.moves)
        `).run(Number(meta.caller.id), username, game.difficulty, elapsedMs, moves, playedAt);
        entries = leaderboard(ctx, game.difficulty);
        ctx.broadcast("leaderboard", { difficulty: game.difficulty, entries });
      }

      return {
        status: won ? "won" : "playing",
        cells: visibleCells(revealed, mines, width, height, won),
        moves,
        elapsedMs,
        entries,
      };
    },
  },
};

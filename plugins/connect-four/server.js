const WIDTH = 7;
const HEIGHT = 6;
const HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function caller(meta) {
  return {
    id: Number(meta.caller.id),
    username: String(meta.caller.username || `Player #${meta.caller.id}`).trim(),
    role: String(meta.caller.role || "user"),
  };
}

function parseBoard(value) {
  try {
    const board = JSON.parse(value);
    return Array.isArray(board) && board.length === WIDTH * HEIGHT
      ? board.map((cell) => cell === "R" || cell === "Y" ? cell : "")
      : Array(WIDTH * HEIGHT).fill("");
  } catch {
    return Array(WIDTH * HEIGHT).fill("");
  }
}

function getGame(ctx, gameId) {
  return ctx.db.prepare(`
    SELECT id, status, player_r_id AS playerRId, player_r_name AS playerRName,
      player_r_role AS playerRRole, player_y_id AS playerYId, player_y_name AS playerYName,
      player_y_role AS playerYRole, client_id AS clientId, board, turn, winner,
      created_at AS createdAt, updated_at AS updatedAt
    FROM connect_four_games WHERE id = ?
  `).get(gameId);
}

function serialize(game, callerId) {
  if (!game) return null;
  const yourColor = Number(game.playerRId) === callerId ? "R" : Number(game.playerYId) === callerId ? "Y" : null;
  let message = "Waiting for an opponent";
  if (game.status === "active") message = `${game.turn === "R" ? "Red" : "Yellow"}'s turn`;
  else if (game.status === "won") message = `${game.winner === "R" ? "Red" : "Yellow"} wins`;
  else if (game.status === "draw") message = "Draw";
  return {
    id: game.id,
    status: game.status,
    board: parseBoard(game.board),
    turn: game.turn,
    winner: game.winner || null,
    message,
    yourColor,
    playerR: { id: Number(game.playerRId), username: game.playerRName, role: game.playerRRole },
    playerY: game.clientId
      ? { id: null, username: game.playerYName, role: "client", clientId: game.clientId }
      : game.playerYId == null ? null : { id: Number(game.playerYId), username: game.playerYName, role: game.playerYRole },
    createdAt: Number(game.createdAt),
    updatedAt: Number(game.updatedAt),
  };
}

function openChallenges(ctx, callerId) {
  return ctx.db.prepare(`
    SELECT id, player_r_id AS playerRId, player_r_name AS playerRName,
      player_r_role AS playerRRole, created_at AS createdAt
    FROM connect_four_games
    WHERE status = 'open'
    ORDER BY created_at ASC
    LIMIT 30
  `).all().map((game) => ({
    id: game.id,
    username: game.playerRName,
    role: game.playerRRole,
    createdAt: Number(game.createdAt),
    canAccept: Number(game.playerRId) !== callerId,
  }));
}

function currentGame(ctx, callerId) {
  return ctx.db.prepare(`
    SELECT id FROM connect_four_games
    WHERE status IN ('open', 'active') AND (player_r_id = ? OR player_y_id = ?)
    ORDER BY updated_at DESC LIMIT 1
  `).get(callerId, callerId);
}

function hasConnectFour(board, row, column, color) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  return directions.some(([rowStep, columnStep]) => {
    let count = 1;
    for (const sign of [-1, 1]) {
      let nextRow = row + rowStep * sign;
      let nextColumn = column + columnStep * sign;
      while (nextRow >= 0 && nextRow < HEIGHT && nextColumn >= 0 && nextColumn < WIDTH && board[nextRow * WIDTH + nextColumn] === color) {
        count += 1;
        nextRow += rowStep * sign;
        nextColumn += columnStep * sign;
      }
    }
    return count >= 4;
  });
}

function broadcast(ctx, gameId) {
  ctx.broadcast("changed", { gameId, at: Date.now() });
}

function applyMove(ctx, game, color, column) {
  if (!game || game.status !== "active") throw new Error("Match is not active");
  if (game.turn !== color) throw new Error("It is not your turn");
  if (!Number.isInteger(column) || column < 0 || column >= WIDTH) throw new Error("Invalid column");
  const board = parseBoard(game.board);
  let row = -1;
  for (let candidate = HEIGHT - 1; candidate >= 0; candidate -= 1) {
    if (!board[candidate * WIDTH + column]) {
      row = candidate;
      break;
    }
  }
  if (row < 0) throw new Error("Column is full");
  board[row * WIDTH + column] = color;
  const won = hasConnectFour(board, row, column, color);
  const draw = !won && board.every(Boolean);
  const status = won ? "won" : draw ? "draw" : "active";
  const turn = color === "R" ? "Y" : "R";
  ctx.db.prepare(`
    UPDATE connect_four_games SET board = ?, turn = ?, status = ?, winner = ?, updated_at = ?
    WHERE id = ? AND status = 'active'
  `).run(JSON.stringify(board), turn, status, won ? color : null, Date.now(), game.id);
  broadcast(ctx, game.id);
  return getGame(ctx, game.id);
}

export default {
  setup(ctx) {
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS connect_four_games (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        player_r_id INTEGER NOT NULL,
        player_r_name TEXT NOT NULL,
        player_r_role TEXT NOT NULL,
        player_y_id INTEGER,
        player_y_name TEXT,
        player_y_role TEXT,
        client_id TEXT,
        board TEXT NOT NULL,
        turn TEXT NOT NULL,
        winner TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS connect_four_status ON connect_four_games(status, updated_at);
    `);
    const columns = ctx.db.prepare("PRAGMA table_info(connect_four_games)").all();
    if (!columns.some((column) => column.name === "client_id")) {
      ctx.db.exec("ALTER TABLE connect_four_games ADD COLUMN client_id TEXT");
    }
    ctx.db.prepare("DELETE FROM connect_four_games WHERE status NOT IN ('open', 'active') AND updated_at < ?")
      .run(Date.now() - HISTORY_TTL_MS);
    ctx.log.info("Connect Four multiplayer ready");
  },

  onEvent(ctx, clientId, event, payload) {
    if (event !== "move") return;
    const gameId = typeof payload?.gameId === "string" ? payload.gameId : "";
    const game = getGame(ctx, gameId);
    if (!game || game.clientId !== clientId) return;
    try {
      applyMove(ctx, game, "Y", Number(payload?.column));
    } catch (error) {
      ctx.log.warn(`Rejected client move from ${clientId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  rpc: {
    snapshot(ctx, params, meta) {
      const user = caller(meta);
      let game = null;
      const requestedId = typeof params?.gameId === "string" ? params.gameId : "";
      if (requestedId) {
        const requested = getGame(ctx, requestedId);
        if (requested && (Number(requested.playerRId) === user.id || Number(requested.playerYId) === user.id)) game = requested;
      }
      if (!game) {
        const current = currentGame(ctx, user.id);
        if (current) game = getGame(ctx, current.id);
      }
      return { game: serialize(game, user.id), challenges: openChallenges(ctx, user.id) };
    },

    createChallenge(ctx, _params, meta) {
      const user = caller(meta);
      const active = currentGame(ctx, user.id);
      if (active) return { game: serialize(getGame(ctx, active.id), user.id) };
      const id = crypto.randomUUID();
      const now = Date.now();
      ctx.db.prepare(`
        INSERT INTO connect_four_games
          (id, status, player_r_id, player_r_name, player_r_role, board, turn, created_at, updated_at)
        VALUES (?, 'open', ?, ?, ?, ?, 'R', ?, ?)
      `).run(id, user.id, user.username, user.role, JSON.stringify(Array(WIDTH * HEIGHT).fill("")), now, now);
      broadcast(ctx, id);
      return { game: serialize(getGame(ctx, id), user.id) };
    },

    startClientMatch(ctx, params, meta) {
      const user = caller(meta);
      const clientId = typeof params?.clientId === "string" ? params.clientId.trim() : "";
      if (!clientId || clientId.length > 256) throw new Error("Invalid client");
      const clientName = typeof params?.clientName === "string" && params.clientName.trim()
        ? params.clientName.trim().slice(0, 96)
        : clientId;
      const existing = ctx.db.prepare(`
        SELECT id FROM connect_four_games
        WHERE status = 'active' AND player_r_id = ? AND client_id = ?
        ORDER BY updated_at DESC LIMIT 1
      `).get(user.id, clientId);
      if (existing) return { game: serialize(getGame(ctx, existing.id), user.id) };
      const active = currentGame(ctx, user.id);
      if (active) {
        const activeGame = getGame(ctx, active.id);
        if (activeGame.status === "open") {
          ctx.db.prepare("UPDATE connect_four_games SET status = 'cancelled', updated_at = ? WHERE id = ?")
            .run(Date.now(), active.id);
        } else {
          throw new Error("Finish your current match first");
        }
      }
      const id = crypto.randomUUID();
      const now = Date.now();
      ctx.db.prepare(`
        INSERT INTO connect_four_games
          (id, status, player_r_id, player_r_name, player_r_role, player_y_name,
           player_y_role, client_id, board, turn, created_at, updated_at)
        VALUES (?, 'active', ?, ?, ?, ?, 'client', ?, ?, 'R', ?, ?)
      `).run(id, user.id, user.username, user.role, clientName, clientId, JSON.stringify(Array(WIDTH * HEIGHT).fill("")), now, now);
      broadcast(ctx, id);
      return { game: serialize(getGame(ctx, id), user.id) };
    },

    acceptChallenge(ctx, params, meta) {
      const user = caller(meta);
      const gameId = typeof params?.gameId === "string" ? params.gameId : "";
      const active = currentGame(ctx, user.id);
      if (active) throw new Error("Finish your current match first");
      const updated = ctx.db.prepare(`
        UPDATE connect_four_games
        SET status = 'active', player_y_id = ?, player_y_name = ?, player_y_role = ?, updated_at = ?
        WHERE id = ? AND status = 'open' AND player_r_id != ?
      `).run(user.id, user.username, user.role, Date.now(), gameId, user.id);
      if (updated.changes !== 1) throw new Error("Challenge is no longer available");
      broadcast(ctx, gameId);
      return { game: serialize(getGame(ctx, gameId), user.id) };
    },

    move(ctx, params, meta) {
      const user = caller(meta);
      const gameId = typeof params?.gameId === "string" ? params.gameId : "";
      const game = getGame(ctx, gameId);
      const color = Number(game?.playerRId) === user.id ? "R" : Number(game?.playerYId) === user.id ? "Y" : "";
      if (!color) throw new Error("You are not in this match");
      return { game: serialize(applyMove(ctx, game, color, Number(params?.column)), user.id) };
    },
  },
};

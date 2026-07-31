const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
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
    return Array.isArray(board) && board.length === 9 ? board.map((cell) => cell === "X" || cell === "O" ? cell : "") : Array(9).fill("");
  } catch {
    return Array(9).fill("");
  }
}

function getGame(ctx, gameId) {
  return ctx.db.prepare(`
    SELECT id, status, player_x_id AS playerXId, player_x_name AS playerXName,
      player_x_role AS playerXRole, player_o_id AS playerOId, player_o_name AS playerOName,
      player_o_role AS playerORole, client_id AS clientId, board, turn, winner,
      created_at AS createdAt, updated_at AS updatedAt
    FROM ttt_games WHERE id = ?
  `).get(gameId);
}

function serialize(game, callerId) {
  if (!game) return null;
  const yourMark = Number(game.playerXId) === callerId ? "X" : Number(game.playerOId) === callerId ? "O" : null;
  let message = "Waiting for an opponent";
  if (game.status === "active") message = `${game.turn}'s turn`;
  else if (game.status === "won") message = `${game.winner} wins`;
  else if (game.status === "draw") message = "Draw";
  return {
    id: game.id,
    status: game.status,
    board: parseBoard(game.board),
    turn: game.turn,
    winner: game.winner || null,
    message,
    yourMark,
    playerX: { id: Number(game.playerXId), username: game.playerXName, role: game.playerXRole },
    playerO: game.clientId
      ? { id: null, username: game.playerOName, role: "client", clientId: game.clientId }
      : game.playerOId == null ? null : { id: Number(game.playerOId), username: game.playerOName, role: game.playerORole },
    createdAt: Number(game.createdAt),
    updatedAt: Number(game.updatedAt),
  };
}

function openChallenges(ctx, callerId) {
  return ctx.db.prepare(`
    SELECT id, player_x_id AS playerXId, player_x_name AS playerXName,
      player_x_role AS playerXRole, created_at AS createdAt
    FROM ttt_games
    WHERE status = 'open'
    ORDER BY created_at ASC
    LIMIT 30
  `).all().map((game) => ({
    id: game.id,
    username: game.playerXName,
    role: game.playerXRole,
    createdAt: Number(game.createdAt),
    canAccept: Number(game.playerXId) !== callerId,
  }));
}

function currentGame(ctx, callerId) {
  return ctx.db.prepare(`
    SELECT id FROM ttt_games
    WHERE status IN ('open', 'active') AND (player_x_id = ? OR player_o_id = ?)
    ORDER BY updated_at DESC LIMIT 1
  `).get(callerId, callerId);
}

function broadcast(ctx, gameId) {
  ctx.broadcast("changed", { gameId, at: Date.now() });
}

function applyMove(ctx, game, mark, cell) {
  if (!game || game.status !== "active") throw new Error("Match is not active");
  if (game.turn !== mark) throw new Error("It is not your turn");
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) throw new Error("Invalid cell");
  const board = parseBoard(game.board);
  if (board[cell]) throw new Error("Cell is already occupied");
  board[cell] = mark;
  const won = WIN_LINES.some((line) => line.every((index) => board[index] === mark));
  const draw = !won && board.every(Boolean);
  const status = won ? "won" : draw ? "draw" : "active";
  const turn = mark === "X" ? "O" : "X";
  ctx.db.prepare(`
    UPDATE ttt_games SET board = ?, turn = ?, status = ?, winner = ?, updated_at = ?
    WHERE id = ? AND status = 'active'
  `).run(JSON.stringify(board), turn, status, won ? mark : null, Date.now(), game.id);
  broadcast(ctx, game.id);
  return getGame(ctx, game.id);
}

export default {
  setup(ctx) {
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ttt_games (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        player_x_id INTEGER NOT NULL,
        player_x_name TEXT NOT NULL,
        player_x_role TEXT NOT NULL,
        player_o_id INTEGER,
        player_o_name TEXT,
        player_o_role TEXT,
        client_id TEXT,
        board TEXT NOT NULL,
        turn TEXT NOT NULL,
        winner TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ttt_games_status ON ttt_games(status, updated_at);
    `);
    const columns = ctx.db.prepare("PRAGMA table_info(ttt_games)").all();
    if (!columns.some((column) => column.name === "client_id")) {
      ctx.db.exec("ALTER TABLE ttt_games ADD COLUMN client_id TEXT");
    }
    ctx.db.prepare("DELETE FROM ttt_games WHERE status NOT IN ('open', 'active') AND updated_at < ?")
      .run(Date.now() - HISTORY_TTL_MS);
    ctx.log.info("Tic Tac Toe multiplayer ready");
  },

  onEvent(ctx, clientId, event, payload) {
    if (event !== "move") return;
    const gameId = typeof payload?.gameId === "string" ? payload.gameId : "";
    const game = getGame(ctx, gameId);
    if (!game || game.clientId !== clientId) return;
    try {
      applyMove(ctx, game, "O", Number(payload?.cell));
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
        if (requested && (Number(requested.playerXId) === user.id || Number(requested.playerOId) === user.id)) game = requested;
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
        INSERT INTO ttt_games
          (id, status, player_x_id, player_x_name, player_x_role, board, turn, created_at, updated_at)
        VALUES (?, 'open', ?, ?, ?, ?, 'X', ?, ?)
      `).run(id, user.id, user.username, user.role, JSON.stringify(Array(9).fill("")), now, now);
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
        SELECT id FROM ttt_games
        WHERE status = 'active' AND player_x_id = ? AND client_id = ?
        ORDER BY updated_at DESC LIMIT 1
      `).get(user.id, clientId);
      if (existing) return { game: serialize(getGame(ctx, existing.id), user.id) };
      const active = currentGame(ctx, user.id);
      if (active) {
        const activeGame = getGame(ctx, active.id);
        if (activeGame.status === "open") {
          ctx.db.prepare("UPDATE ttt_games SET status = 'cancelled', updated_at = ? WHERE id = ?")
            .run(Date.now(), active.id);
        } else {
          throw new Error("Finish your current match first");
        }
      }
      const id = crypto.randomUUID();
      const now = Date.now();
      ctx.db.prepare(`
        INSERT INTO ttt_games
          (id, status, player_x_id, player_x_name, player_x_role, player_o_name,
           player_o_role, client_id, board, turn, created_at, updated_at)
        VALUES (?, 'active', ?, ?, ?, ?, 'client', ?, ?, 'X', ?, ?)
      `).run(id, user.id, user.username, user.role, clientName, clientId, JSON.stringify(Array(9).fill("")), now, now);
      broadcast(ctx, id);
      return { game: serialize(getGame(ctx, id), user.id) };
    },

    acceptChallenge(ctx, params, meta) {
      const user = caller(meta);
      const gameId = typeof params?.gameId === "string" ? params.gameId : "";
      const active = currentGame(ctx, user.id);
      if (active) throw new Error("Finish your current match first");
      const updated = ctx.db.prepare(`
        UPDATE ttt_games
        SET status = 'active', player_o_id = ?, player_o_name = ?, player_o_role = ?, updated_at = ?
        WHERE id = ? AND status = 'open' AND player_x_id != ?
      `).run(user.id, user.username, user.role, Date.now(), gameId, user.id);
      if (updated.changes !== 1) throw new Error("Challenge is no longer available");
      broadcast(ctx, gameId);
      return { game: serialize(getGame(ctx, gameId), user.id) };
    },

    move(ctx, params, meta) {
      const user = caller(meta);
      const gameId = typeof params?.gameId === "string" ? params.gameId : "";
      const game = getGame(ctx, gameId);
      const mark = Number(game?.playerXId) === user.id ? "X" : Number(game?.playerOId) === user.id ? "O" : "";
      if (!mark) throw new Error("You are not in this match");
      return { game: serialize(applyMove(ctx, game, mark, Number(params?.cell)), user.id) };
    },
  },
};

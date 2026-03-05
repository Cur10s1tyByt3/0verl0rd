import { logger } from "../logger";
import { sendPingRequest } from "../wsHandlers";
import type { ClientInfo } from "../types";
import { pruneStaleClients } from "./stale-prune";

type StartMaintenanceParams = {
  getClients: () => Map<string, ClientInfo>;
  setOnlineState: (id: string, online: boolean) => void;
  deleteClient: (id: string) => void;
  staleMs: number;
  pruneBatch: number;
  heartbeatIntervalMs: number;
  disconnectTimeoutMs: number;
};

export function startMaintenanceLoops(params: StartMaintenanceParams): void {
  setInterval(() => {
    pruneStaleClients({
      clients: params.getClients(),
      staleMs: params.staleMs,
      pruneBatch: params.pruneBatch,
      setOnlineState: params.setOnlineState,
      deleteClient: params.deleteClient,
    });
  }, 5000);

  setInterval(() => {
    const now = Date.now();
    for (const [id, info] of params.getClients().entries()) {
      if (info.role !== "client") continue;
      if (
        info.lastPingNonce !== undefined &&
        info.lastPingSent &&
        now - info.lastPingSent > params.heartbeatIntervalMs + params.disconnectTimeoutMs
      ) {
        logger.warn(`[ping] no pong from ${id} within timeout; closing socket`);
        try {
          info.ws.close(4001, "ping timeout");
        } catch (err) {
          logger.debug(`[ping] close failed for ${id}`, err);
        }
        continue;
      }
      try {
        sendPingRequest(info, info.ws, "heartbeat");
      } catch (err) {
        logger.debug(`[ping] heartbeat failed for ${id}`, err);
      }
    }
  }, params.heartbeatIntervalMs);
}

import type { ServerWebSocket } from "bun";
import type { SocketData } from "../sessions/types";

type OpenHandler<TLifecycleDeps> = (
  ws: ServerWebSocket<SocketData>,
  deps: TLifecycleDeps,
) => void;

type MessageHandler<TLifecycleDeps> = (
  ws: ServerWebSocket<SocketData>,
  message: string | ArrayBuffer | Uint8Array,
  deps: TLifecycleDeps,
) => void;

type CloseHandler<TLifecycleDeps> = (
  ws: ServerWebSocket<SocketData>,
  code: number,
  reason: string,
  deps: TLifecycleDeps,
) => void;

export function createWebSocketRuntime<TLifecycleDeps>(deps: {
  maxClientPayloadBytes: number;
  maxViewerPayloadBytes: number;
  lifecycleDeps: TLifecycleDeps;
  handleWebSocketOpen: OpenHandler<TLifecycleDeps>;
  handleWebSocketMessage: MessageHandler<TLifecycleDeps>;
  handleWebSocketClose: CloseHandler<TLifecycleDeps>;
}) {
  return {
    perMessageDeflate: true,
    maxPayloadLength: Math.max(deps.maxClientPayloadBytes, deps.maxViewerPayloadBytes),
    idleTimeout: 255,
    sendPings: true,
    open(ws: ServerWebSocket<SocketData>) {
      deps.handleWebSocketOpen(ws, deps.lifecycleDeps);
    },
    message(ws: ServerWebSocket<SocketData>, message: string | ArrayBuffer | Uint8Array) {
      deps.handleWebSocketMessage(ws, message, deps.lifecycleDeps);
    },
    close(ws: ServerWebSocket<SocketData>, code: number, reason: string) {
      deps.handleWebSocketClose(ws, code, reason, deps.lifecycleDeps);
    },
  };
}

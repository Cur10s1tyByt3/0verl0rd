import { describe, expect, test } from "bun:test";
import { decodeMessage } from "./protocol";
import { metrics } from "./metrics";
import { handlePong, sendPingRequest } from "./wsHandlers";

type MockWs = { sent: Uint8Array[]; send: (msg: Uint8Array) => void };

describe("wsHandlers ping/pong", () => {
  test("sendPingRequest sends a ping once per outstanding nonce", () => {
    const ws: MockWs = {
      sent: [],
      send(msg) {
        this.sent.push(msg);
      },
    };
    const info = {
      id: "client-1",
      role: "client",
      ws,
      lastSeen: Date.now(),
    } as any;

    sendPingRequest(info, ws, "test");
    expect(ws.sent.length).toBe(1);
    const payload = decodeMessage(ws.sent[0]) as any;
    expect(payload.type).toBe("ping");
    expect(typeof payload.ts).toBe("number");

    sendPingRequest(info, ws, "test");
    expect(ws.sent.length).toBe(1);
  });

  test("handlePong clears nonce and records ping", () => {
    metrics.reset();
    const ws: MockWs = {
      sent: [],
      send(msg) {
        this.sent.push(msg);
      },
    };
    const now = Date.now();
    const info = {
      id: "client-2",
      role: "client",
      ws,
      lastSeen: now,
      lastPingSent: now - 10,
      lastPingNonce: 1234,
    } as any;

    handlePong(info, { type: "pong", ts: 1234 } as any);
    expect(info.lastPingNonce).toBeUndefined();
    expect(typeof info.pingMs).toBe("number");
    const snapshot = metrics.getSnapshot();
    expect(snapshot.ping.count).toBeGreaterThan(0);
  });

  test("handlePong ignores mismatched nonces", () => {
    const now = Date.now();
    const info = {
      id: "client-3",
      role: "client",
      ws: { sent: [], send() {} },
      lastSeen: now,
      lastPingSent: now - 10,
      lastPingNonce: 2222,
    } as any;

    handlePong(info, { type: "pong", ts: 3333 } as any);
    expect(info.lastPingNonce).toBe(2222);
  });
});

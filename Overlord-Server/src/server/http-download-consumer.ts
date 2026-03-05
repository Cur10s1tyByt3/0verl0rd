import fs from "fs/promises";
import type { FileHandle } from "fs/promises";
import { logger } from "../logger";

export type PendingHttpDownload = {
  commandId: string;
  clientId: string;
  path: string;
  fileName: string;
  total: number;
  receivedBytes: number;
  receivedOffsets: Set<number>;
  receivedChunks: Set<number>;
  chunkSize: number;
  expectedChunks: number;
  loggedTotal?: boolean;
  loggedFirstChunk?: boolean;
  tmpPath: string;
  fileHandle: FileHandle;
  resolve: (entry: PendingHttpDownload) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export async function consumeHttpDownloadPayload(
  payload: any,
  pendingHttpDownloads: Map<string, PendingHttpDownload>,
): Promise<void> {
  const commandId = typeof payload?.commandId === "string" ? payload.commandId : "";
  if (!commandId) return;

  const pending = pendingHttpDownloads.get(commandId);
  if (!pending) return;

  if (payload?.error) {
    clearTimeout(pending.timeout);
    pendingHttpDownloads.delete(commandId);
    try {
      await pending.fileHandle.close();
    } catch {}
    try {
      await fs.unlink(pending.tmpPath);
    } catch {}
    pending.reject(new Error(String(payload.error)));
    return;
  }

  const toNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "bigint") {
      const asNumber = Number(value);
      if (Number.isSafeInteger(asNumber)) return asNumber;
    }
    return null;
  };

  const rawTotal = payload?.total;
  if (!pending.total) {
    const total = toNumber(rawTotal);
    if (total && total > 0) {
      pending.total = total;
    }
  }
  if (pending.total > 0 && !pending.loggedTotal) {
    pending.loggedTotal = true;
    logger.debug("[filebrowser] http download total", {
      commandId,
      total: pending.total,
      rawTotalType: typeof rawTotal,
    });
  }

  if (payload?.data) {
    let data = payload.data;
    if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    } else if (typeof data === "string") {
      data = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    } else if (ArrayBuffer.isView(data)) {
      data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }

    if (data instanceof Uint8Array) {
      const offset = toNumber(payload?.offset);
      const chunkIndex = toNumber(payload?.chunkIndex);
      const chunksTotal = toNumber(payload?.chunksTotal);

      if (offset === null) {
        logger.debug("[filebrowser] http download missing offset", {
          commandId,
          rawOffsetType: typeof payload?.offset,
        });
      }

      if (!pending.chunkSize && data.length > 0) {
        pending.chunkSize = data.length;
      }
      if (pending.expectedChunks === 0) {
        if (chunksTotal && chunksTotal > 0) {
          pending.expectedChunks = chunksTotal;
        } else if (pending.total > 0 && pending.chunkSize > 0) {
          pending.expectedChunks = Math.ceil(pending.total / pending.chunkSize);
        }
      }

      if (!pending.loggedFirstChunk) {
        pending.loggedFirstChunk = true;
        logger.debug("[filebrowser] http download first chunk", {
          commandId,
          size: data.length,
          offset,
          chunkIndex,
          chunksTotal,
          expectedChunks: pending.expectedChunks,
        });
      }

      const shouldWrite = chunkIndex !== null
        ? !pending.receivedChunks.has(chunkIndex)
        : !pending.receivedOffsets.has(offset ?? 0);

      if (shouldWrite) {
        try {
          await pending.fileHandle.write(data, 0, data.length, offset ?? 0);
        } catch (err) {
          clearTimeout(pending.timeout);
          pendingHttpDownloads.delete(commandId);
          try {
            await pending.fileHandle.close();
          } catch {}
          try {
            await fs.unlink(pending.tmpPath);
          } catch {}
          pending.reject(err as Error);
          return;
        }
        if (chunkIndex !== null) {
          pending.receivedChunks.add(chunkIndex);
        } else {
          pending.receivedOffsets.add(offset ?? 0);
        }
        pending.receivedBytes += data.length;
      }
    }
  }

  const receivedChunkCount = pending.receivedChunks.size + pending.receivedOffsets.size;
  const hasAllChunks = pending.expectedChunks > 0
    ? receivedChunkCount >= pending.expectedChunks
    : pending.total > 0 && pending.receivedBytes >= pending.total;

  if ((pending.total > 0 ? pending.receivedBytes >= pending.total : hasAllChunks && pending.receivedBytes > 0) && hasAllChunks) {
    clearTimeout(pending.timeout);
    pendingHttpDownloads.delete(commandId);
    try {
      await pending.fileHandle.close();
    } catch {}
    pending.resolve(pending);
  }
}

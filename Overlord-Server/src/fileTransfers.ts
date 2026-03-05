export type FileUploadPayload = {
  path: string;
  data: Uint8Array;
  offset: number;
  total: number;
  transferId: string;
};

export function coerceUploadData(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (typeof data === "string") {
    try {
      const binaryString = atob(data || "");
      const out = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i += 1) {
        out[i] = binaryString.charCodeAt(i);
      }
      return out;
    } catch {
      return null;
    }
  }
  return null;
}

export function normalizeFileUploadPayload(payload: any): FileUploadPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const toNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "bigint") {
      const asNumber = Number(value);
      if (Number.isSafeInteger(asNumber)) return asNumber;
    }
    return null;
  };
  const data = coerceUploadData(payload.data);
  if (!data) {
    return null;
  }
  const path = typeof payload.path === "string" ? payload.path : "";
  const offset = toNumber(payload.offset) || 0;
  const total = toNumber(payload.total) || 0;
  const transferId = typeof payload.transferId === "string" ? payload.transferId : "";

  return { path, data, offset, total, transferId };
}

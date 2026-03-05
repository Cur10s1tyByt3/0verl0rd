import { describe, expect, test } from "bun:test";
import { coerceUploadData, normalizeFileUploadPayload } from "./fileTransfers";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

describe("fileTransfers", () => {
  test("coerceUploadData handles Uint8Array", () => {
    const input = new Uint8Array([1, 2, 3]);
    const out = coerceUploadData(input);
    expect(out).not.toBeNull();
    expect(Array.from(out || [])).toEqual([1, 2, 3]);
  });

  test("coerceUploadData handles ArrayBuffer", () => {
    const input = new Uint8Array([4, 5, 6]).buffer;
    const out = coerceUploadData(input);
    expect(out).not.toBeNull();
    expect(Array.from(out || [])).toEqual([4, 5, 6]);
  });

  test("coerceUploadData handles base64 string", () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const input = toBase64(bytes);
    const out = coerceUploadData(input);
    expect(out).not.toBeNull();
    expect(Array.from(out || [])).toEqual([7, 8, 9]);
  });

  test("coerceUploadData rejects invalid data", () => {
    expect(coerceUploadData(123)).toBeNull();
  });

  test("normalizeFileUploadPayload fills defaults", () => {
    const payload = {
      path: "/tmp/file.txt",
      data: new Uint8Array([1, 2, 3]),
      offset: 10,
      total: 30,
      transferId: "t-1",
    };
    const out = normalizeFileUploadPayload(payload);
    expect(out).not.toBeNull();
    expect(out?.path).toBe("/tmp/file.txt");
    expect(out?.offset).toBe(10);
    expect(out?.total).toBe(30);
    expect(out?.transferId).toBe("t-1");
    expect(Array.from(out?.data || [])).toEqual([1, 2, 3]);
  });

  test("normalizeFileUploadPayload rejects missing data", () => {
    const out = normalizeFileUploadPayload({ path: "/tmp/file.txt" });
    expect(out).toBeNull();
  });
});

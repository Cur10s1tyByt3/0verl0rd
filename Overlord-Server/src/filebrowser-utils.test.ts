import { describe, expect, test } from "bun:test";
// @ts-expect-error Browser assets are intentionally shipped as plain JavaScript.
import { joinRemotePath } from "../public/assets/filebrowser-utils.js";

describe("file browser remote upload paths", () => {
  test("joins files to Windows destinations without mixing separators", () => {
    expect(joinRemotePath("C:\\Temp", "tool.exe")).toBe("C:\\Temp\\tool.exe");
    expect(joinRemotePath("C:\\", "tool.exe")).toBe("C:\\tool.exe");
  });

  test("joins files to Unix and normalized destinations", () => {
    expect(joinRemotePath("/tmp", "tool.sh")).toBe("/tmp/tool.sh");
    expect(joinRemotePath("C:/Temp", "tool.exe")).toBe("C:/Temp/tool.exe");
  });

  test("keeps relative root uploads relative", () => {
    expect(joinRemotePath(".", "tool.bin")).toBe("tool.bin");
    expect(joinRemotePath("", "tool.bin")).toBe("tool.bin");
  });
});

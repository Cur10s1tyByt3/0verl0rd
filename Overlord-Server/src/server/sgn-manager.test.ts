import { describe, expect, test } from "bun:test";
import { selectSgnReleaseAsset } from "./sgn-manager";

const rustAssets = [
  {
    name: "sgn-aarch64-apple-darwin.tar.gz",
    browser_download_url: "https://example.test/sgn-aarch64-apple-darwin.tar.gz",
  },
  {
    name: "sgn-x86_64-pc-windows-msvc.zip",
    browser_download_url: "https://example.test/sgn-x86_64-pc-windows-msvc.zip",
  },
  {
    name: "sgn-x86_64-unknown-linux-musl.tar.gz",
    browser_download_url: "https://example.test/sgn-x86_64-unknown-linux-musl.tar.gz",
  },
  {
    name: "sgn-x86_64-unknown-linux-musl.tar.gz.zip",
    browser_download_url: "https://example.test/sgn-x86_64-unknown-linux-musl.tar.gz.zip",
  },
];

describe("SGN Rust release selection", () => {
  test("selects the native target-triple archive", () => {
    expect(selectSgnReleaseAsset(rustAssets, "linux", "x64")).toMatchObject({
      assetName: "sgn-x86_64-unknown-linux-musl.tar.gz",
      archiveFormat: "tar.gz",
    });
    expect(selectSgnReleaseAsset(rustAssets, "win32", "x64")).toMatchObject({
      assetName: "sgn-x86_64-pc-windows-msvc.zip",
      archiveFormat: "zip",
    });
    expect(selectSgnReleaseAsset(rustAssets, "darwin", "arm64")).toMatchObject({
      assetName: "sgn-aarch64-apple-darwin.tar.gz",
      archiveFormat: "tar.gz",
    });
  });

  test("does not substitute an incompatible architecture", () => {
    expect(selectSgnReleaseAsset(rustAssets, "linux", "arm64")).toBeNull();
    expect(selectSgnReleaseAsset(rustAssets, "darwin", "x64")).toBeNull();
  });
});

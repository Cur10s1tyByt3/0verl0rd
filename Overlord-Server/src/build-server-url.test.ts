import { describe, expect, test } from "bun:test";
// @ts-expect-error Browser assets are intentionally shipped as plain JavaScript.
import { isLocalServerAddress } from "../public/assets/build-server-url.js";

describe("builder local server URL warning", () => {
  test.each([
    "localhost",
    "localhost:5173",
    "https://api.localhost/list.txt",
    "127.0.0.1:5173",
    "10.0.0.5",
    "172.16.4.2:443",
    "172.31.255.254",
    "192.168.1.20",
    "169.254.10.1",
    "[::1]:5173",
    "fd12:3456::1",
    "[fe80::1]:5173",
    "::ffff:127.0.0.1",
  ])("recognizes %s as local", (value) => {
    expect(isLocalServerAddress(value)).toBe(true);
  });

  test.each([
    "example.com",
    "example.com:5173",
    "https://example.com/list.txt",
    "8.8.8.8:443",
    "172.32.0.1",
    "192.169.1.1",
    "2606:4700:4700::1111",
    "",
  ])("does not flag %s as local", (value) => {
    expect(isLocalServerAddress(value)).toBe(false);
  });
});

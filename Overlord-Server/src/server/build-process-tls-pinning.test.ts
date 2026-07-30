import { describe, expect, test } from "bun:test";
import { createAgentTlsPinsLdflag } from "./build-process";

describe("agent build TLS pin embedding", () => {
  test("creates the linker flag consumed by the Go agent config", () => {
    const currentPin = Buffer.alloc(32, 0x11).toString("base64");
    const nextPin = Buffer.alloc(32, 0x22).toString("base64");

    expect(createAgentTlsPinsLdflag([currentPin, nextPin])).toBe(
      `-X overlord-client/cmd/agent/config.DefaultTLSSPKIPins=${currentPin},${nextPin}`,
    );
  });

  test("does not create a linker flag without pins", () => {
    expect(createAgentTlsPinsLdflag([])).toBe("");
  });
});

import { describe, expect, test } from "bun:test";
import { createAgentTlsPinsLdflag, createBaseGoLdflags } from "./build-process";

describe("agent base linker flags", () => {
  test("allows Pion's Android interface dependency to link on current Go", () => {
    expect(createBaseGoLdflags("android", true)).toBe(
      "-s -w -buildid= -checklinkname=0",
    );
    expect(createBaseGoLdflags("android", false)).toBe("-checklinkname=0");
  });

  test("does not relax linkname checks for other targets", () => {
    expect(createBaseGoLdflags("linux", true)).toBe("-s -w -buildid=");
    expect(createBaseGoLdflags("windows", false)).toBe("");
  });
});

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

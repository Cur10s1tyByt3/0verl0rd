import { describe, expect, test } from "bun:test";
import {
  BACKSTAGE_DLL_NAME,
  BACKSTAGE_LEGACY_DLL_NAME,
  injectionDllCandidates,
} from "./backstage-dll-cache";

describe("Backstage DLL command-version artifacts", () => {
  test("maps v1 to the fixed-export artifact and v2 to the randomized artifact", () => {
    expect(injectionDllCandidates(1).every((candidate) => candidate.endsWith(BACKSTAGE_LEGACY_DLL_NAME))).toBe(true);
    expect(injectionDllCandidates(2).every((candidate) => candidate.endsWith(BACKSTAGE_DLL_NAME))).toBe(true);
  });
});

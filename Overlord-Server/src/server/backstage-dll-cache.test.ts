import { describe, expect, test } from "bun:test";
import {
  BACKSTAGE_DLL_NAME,
  injectionDllCandidates,
} from "./backstage-dll-cache";

describe("Backstage DLL artifacts", () => {
  test("serves a single randomized-export artifact", () => {
    expect(injectionDllCandidates().length).toBeGreaterThan(0);
    expect(injectionDllCandidates().every((candidate) => candidate.endsWith(BACKSTAGE_DLL_NAME))).toBe(true);
  });
});
import { describe, expect, it } from "vitest";
import { isAdminEmail, isAllowedEmail, phaseName, verdictFor } from "./config";

describe("access helpers", () => {
  it("recognizes administrator emails without case sensitivity", () => {
    expect(isAdminEmail("MAGRAZ@CORPORATIVOMAF.COM")).toBe(true);
    expect(isAdminEmail("user@corporativomaf.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });

  it("requires a verified email in the allowed domain", () => {
    expect(isAllowedEmail("operator@corporativomaf.com", true)).toBe(true);
    expect(isAllowedEmail("operator@corporativomaf.com", false)).toBe(false);
    expect(isAllowedEmail("operator@sub.corporativomaf.com", true)).toBe(false);
    expect(isAllowedEmail(undefined, true)).toBe(false);
  });
});

describe("evaluation labels", () => {
  it.each([
    [8, "APTO"],
    [6, "APTO CON OBSERVACIONES"],
    [0, "NO APTO"],
  ])("returns the expected verdict at score %i", (score, expected) => {
    expect(verdictFor(score).label).toBe(expected);
  });

  it("uses the nearest lower verdict and formats unknown phases", () => {
    expect(verdictFor(7.99).label).toBe("APTO CON OBSERVACIONES");
    expect(phaseName(1)).toBe("Adaptación Sensorial");
    expect(phaseName(99)).toBe("Fase 99");
  });
});

import { describe, expect, it } from "vitest";
import { formatLocalDateInput } from "./date";

describe("formatLocalDateInput", () => {
  it("uses the local calendar date for date inputs", () => {
    const date = new Date(2026, 10, 9, 23, 30);

    expect(formatLocalDateInput(date)).toBe("2026-11-09");
  });
});

import { describe, it, expect } from "vitest";
import { formatPeriod } from "@/lib/data/utils";

describe("formatPeriod", () => {
  it("is unchanged for a range within one year", () => {
    expect(formatPeriod("2026-03-01", "2026-03-31")).toBe("Mar 1 – Mar 31, 2026");
  });
  it("shows both years when a multi-month range crosses a year boundary", () => {
    expect(formatPeriod("2024-01-01", "2025-12-31")).toBe("Jan 1, 2024 – Dec 31, 2025");
  });
});

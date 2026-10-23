import { describe, expect, it } from "vitest";
import { formatTransactionProgress } from "./format";

describe("formatTransactionProgress", () => {
  it("prints the total once", () => {
    expect(formatTransactionProgress(0, 2)).toBe("0 of 2 transactions");
    expect(formatTransactionProgress(1, 2)).toBe("1 of 2 transactions");
  });

  it("uses the singular for one transaction", () => {
    expect(formatTransactionProgress(0, 1)).toBe("0 of 1 transaction");
    expect(formatTransactionProgress(1, 1)).toBe("1 of 1 transaction");
  });
});

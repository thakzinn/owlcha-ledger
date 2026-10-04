import { describe, expect, it } from "vitest";
import { deliveryDeduction, type SummaryEntry } from "./SummaryCard";

const entry = (overrides: Partial<SummaryEntry> = {}): SummaryEntry => ({
  description: "Grab",
  amount: 679,
  channel: "โอน",
  ...overrides,
});

describe("deliveryDeduction", () => {
  it("uses the saved gross amount to show the pre-deduction and deducted values", () => {
    expect(deliveryDeduction(entry({ gross: 1_000 }))).toEqual({
      gross: 1_000,
      deducted: 321,
    });
  });

  it("calculates legacy delivery entries using the default GP and VAT rates", () => {
    const result = deliveryDeduction(entry());

    expect(result?.gross).toBeCloseTo(1_000);
    expect(result?.deducted).toBeCloseTo(321);
  });

  it("does not return a deduction for non-delivery income", () => {
    expect(deliveryDeduction(entry({ description: "ขายหน้าร้าน" }))).toBeNull();
  });
});

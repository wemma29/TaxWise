import { describe, it, expect } from "vitest";
import { calculateCapitalGain, validateCapitalGain } from "@/lib/capital-gain";

describe("capital gain arithmetic", () => {
  it("subtracts cost basis from selling proceeds", () => {
    expect(calculateCapitalGain({ purchasePrice: 1000, sellingPrice: 1500, basisAdjustment: null, sellingFees: null }).gainOrLoss).toBe(500);
  });
  it("adds signed basis adjustments and deducts selling fees", () => {
    const r = calculateCapitalGain({ purchasePrice: 1000, sellingPrice: 1500, basisAdjustment: 100, sellingFees: 25 });
    expect(r.adjustedCostBasis).toBe(1100);
    expect(r.netProceeds).toBe(1475);
    expect(r.gainOrLoss).toBe(375);
  });
  it("returns losses and break-even without floating point drift", () => {
    expect(calculateCapitalGain({ purchasePrice: 0.3, sellingPrice: 0.2, basisAdjustment: null, sellingFees: null }).gainOrLoss).toBe(-0.1);
    expect(calculateCapitalGain({ purchasePrice: 10, sellingPrice: 10, basisAdjustment: null, sellingFees: null }).classification).toBe("break-even");
  });
  it("rejects invalid or missing money inputs", () => {
    expect(() => validateCapitalGain({ purchasePrice: -1, sellingPrice: 10, basisAdjustment: null, sellingFees: null })).toThrow();
    expect(() => validateCapitalGain({ purchasePrice: 1.001, sellingPrice: 10, basisAdjustment: null, sellingFees: null })).toThrow();
    expect(() => validateCapitalGain({ sellingPrice: 10 })).toThrow();
  });
  it("returns no tax liability or rate", () => {
    const r = calculateCapitalGain({ purchasePrice: 1000, sellingPrice: 1500, basisAdjustment: null, sellingFees: null });
    expect(r).not.toHaveProperty("taxLiability");
    expect(r).not.toHaveProperty("taxRate");
  });
});
import { z } from "zod";

export const capitalGainSchema = z.object({
  purchasePrice: z.number().describe("Purchase price / original cost basis in USD"),
  sellingPrice: z.number().describe("Gross selling proceeds in USD"),
  basisAdjustment: z.number().nullable().describe("Signed adjustment to basis in USD; null if none"),
  sellingFees: z.number().nullable().describe("Selling fees deducted from proceeds in USD; null if none"),
});
export type CapitalGainInputs = z.infer<typeof capitalGainSchema>;
export type CapitalGainCalculation = CapitalGainInputs & {
  adjustedCostBasis: number;
  netProceeds: number;
  gainOrLoss: number;
  formula: string;
  classification: "gain" | "loss" | "break-even";
};

export function validateCapitalGain(input: unknown): CapitalGainInputs {
  const data = capitalGainSchema.parse(input);
  for (const value of Object.values(data)) {
    if (value !== null && (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001)) {
      throw new Error("Enter finite USD amounts with at most two decimal places, up to $1 billion.");
    }
  }
  if (data.purchasePrice < 0 || data.sellingPrice < 0 || (data.sellingFees ?? 0) < 0) throw new Error("Purchase price, selling price and selling fees cannot be negative.");
  if (data.purchasePrice + (data.basisAdjustment ?? 0) < 0) throw new Error("Adjusted cost basis cannot be negative.");
  return data;
}

export const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

// Integer cents keep decimal arithmetic deterministic. This is not a tax-liability calculator.
export function calculateCapitalGain(input: CapitalGainInputs): CapitalGainCalculation {
  const data = validateCapitalGain(input);
  const cents = (v: number) => Math.round(v * 100);
  const adjustedCostBasis = (cents(data.purchasePrice) + cents(data.basisAdjustment ?? 0)) / 100;
  const netProceeds = (cents(data.sellingPrice) - cents(data.sellingFees ?? 0)) / 100;
  const gainOrLoss = (cents(netProceeds) - cents(adjustedCostBasis)) / 100;
  return { ...data, adjustedCostBasis, netProceeds, gainOrLoss,
    formula: `(${usd(data.sellingPrice)} − ${usd(data.sellingFees ?? 0)}) − (${usd(data.purchasePrice)} + ${usd(data.basisAdjustment ?? 0)}) = ${usd(gainOrLoss)}`,
    classification: gainOrLoss > 0 ? "gain" : gainOrLoss < 0 ? "loss" : "break-even",
  };
}
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { validateCapitalGain, usd, type CapitalGainInputs } from "@/lib/capital-gain";

export function CalculationApproval({ inputs, busy, onDecision }: {
  inputs: CapitalGainInputs; busy: boolean;
  onDecision: (approved: boolean, inputs?: CapitalGainInputs) => void;
}) {
  const [draft, setDraft] = useState({ purchasePrice: String(inputs.purchasePrice), sellingPrice: String(inputs.sellingPrice), basisAdjustment: String(inputs.basisAdjustment ?? 0), sellingFees: String(inputs.sellingFees ?? 0) });
  const [error, setError] = useState("");
  const labels = { purchasePrice: "Purchase price (USD)", sellingPrice: "Selling price (USD)", basisAdjustment: "Basis adjustment (USD, signed)", sellingFees: "Selling fees (USD)" };
  function approve() {
    try {
      if (Object.values(draft).some((v) => !v.trim())) throw new Error("Complete all amounts; enter 0 for no adjustment or fees.");
      const data = validateCapitalGain(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v)])));
      setError("");
      onDecision(true, data);
    } catch (e) { setError(e instanceof Error ? e.message : "Check the amounts."); }
  }
  return <section role="region" aria-label="Calculation approval" className="mt-8 border-y border-border py-6">
    <h2 className="font-serif text-xl font-bold text-primary">Approve capital gain/loss calculation</h2>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {(Object.keys(labels) as (keyof typeof labels)[]).map((name) => <label key={name} className="text-sm font-medium text-foreground">
        {labels[name]}
        <input type="number" step="0.01" value={draft[name]} disabled={busy} onChange={(e) => setDraft({ ...draft, [name]: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background p-3 text-foreground outline-none focus:ring-2 focus:ring-ring" />
      </label>)}
    </div>
    <p className="mt-4 break-words text-sm text-foreground">Capital gain/loss = (selling price − selling fees) − (purchase price + basis adjustment)</p>
    <p className="mt-2 break-words font-mono text-sm text-muted-foreground">({usd(Number(draft.sellingPrice))} − {usd(Number(draft.sellingFees))}) − ({usd(Number(draft.purchasePrice))} + {usd(Number(draft.basisAdjustment))})</p>
    <p className="mt-2 text-sm text-muted-foreground">Not tax owed. Calculation awaiting approval.</p>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-3">
      <Button type="button" onClick={approve} disabled={busy}>Approve calculation</Button>
      <Button type="button" variant="outline" onClick={() => onDecision(false)} disabled={busy}>Cancel calculation</Button>
    </div>
  </section>;
}
import { webcrypto } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { sealContinuation, openContinuation } from "@/lib/agent-continuation.server";
import type { AgentState } from "@/lib/agent-core.server";

const state: AgentState = { question: "Calculate gain", messages: [{ role: "user", content: "Calculate gain" }], trace: [], sources: [], iterations: 2,
  pending: { approvalId: "approval-test", toolCallId: "call-test", iteration: 2, inputs: { purchasePrice: 100, sellingPrice: 200, basisAdjustment: null, sellingFees: null } } };

describe("protected approval continuation", () => {
  it("round-trips the real cumulative budget without exposing the transcript", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const token = await sealContinuation(state, "test-only-secret");
    expect(token).not.toContain("Calculate gain");
    expect((await openContinuation(token, "test-only-secret")).iterations).toBe(2);
    vi.unstubAllGlobals();
  });
  it("rejects tampering or a different encryption secret", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const token = await sealContinuation(state, "test-only-secret");
    await expect(openContinuation(token, "wrong-test-secret")).rejects.toThrow();
    await expect(openContinuation("broken." + token.split(".")[1], "test-only-secret")).rejects.toThrow();
    vi.unstubAllGlobals();
  });
  it("rejects approvals after the three-step budget is exhausted", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const token = await sealContinuation({ ...state, iterations: 3 }, "test-only-secret");
    await expect(openContinuation(token, "test-only-secret")).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});
import { describe, it, expect } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { runAgentLoop } from "@/lib/agent-core.server";
import { calculateCapitalGain } from "@/lib/capital-gain";

const inputs = { purchasePrice: 1000, sellingPrice: 1500, basisAdjustment: null, sellingFees: null };
function modelWithSteps(steps: { tool?: string; input?: unknown; text?: string }[]) {
  let calls = 0;
  return { calls: () => calls, model: new MockLanguageModelV3({ doStream: async () => {
    const step = steps[calls++] ?? { text: "[NOT VERIFIED] No evidence." };
    return { stream: new ReadableStream({ start(c) {
      c.enqueue({ type: "stream-start", warnings: [] });
      if (step.tool) c.enqueue({ type: "tool-call", toolCallId: `call_${calls}`, toolName: step.tool, input: JSON.stringify(step.input) });
      else { c.enqueue({ type: "text-start", id: "t" }); c.enqueue({ type: "text-delta", id: "t", delta: step.text ?? "" }); c.enqueue({ type: "text-end", id: "t" }); }
      c.enqueue({ type: "finish", finishReason: { unified: step.tool ? "tool-calls" : "stop", raw: step.tool ? "tool_calls" : "stop" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } } as any);
      c.close();
    } }) } as any;
  } }) };
}
const search = async () => ({ results: [], errors: [] });

describe("calculation approval and shared budget", () => {
  it("does not execute before approval; resumes using exact edited amounts", async () => {
    const m = modelWithSteps([{ tool: "calculate_capital_gain", input: inputs }, { text: "[NOT VERIFIED] Calculated." }]);
    let executions = 0;
    const calculate: typeof calculateCapitalGain = (data) => { executions++; return calculateCapitalGain(data); };
    const first = await runAgentLoop({ question: "Calculate my gain", model: m.model, search, calculate });
    expect(executions).toBe(0);
    expect(first.iterations).toBe(1);
    expect(first.continuation?.pending?.inputs).toEqual(inputs);
    if (!first.continuation) throw new Error("Missing approval");
    const final = await runAgentLoop({ question: "Calculate my gain", model: m.model, search, calculate, state: first.continuation, decision: { approved: true, inputs: { ...inputs, sellingPrice: 1600 } } });
    expect(executions).toBe(1);
    expect(final.calculation?.gainOrLoss).toBe(600);
    expect(final.iterations).toBe(2);
    expect(final.trace.some((t) => t.type === "approval")).toBe(true);
  });
  it("cancellation executes neither the calculation nor another model step", async () => {
    const m = modelWithSteps([{ tool: "calculate_capital_gain", input: inputs }]);
    let executions = 0;
    const calculate: typeof calculateCapitalGain = (data) => { executions++; return calculateCapitalGain(data); };
    const first = await runAgentLoop({ question: "Calculate my gain", model: m.model, search, calculate });
    if (!first.continuation) throw new Error("Missing approval");
    const final = await runAgentLoop({ question: "Calculate my gain", model: m.model, search, calculate, state: first.continuation, decision: { approved: false } });
    expect(executions).toBe(0);
    expect(m.calls()).toBe(1);
    expect(final.trace.some((t) => t.type === "cancellation")).toBe(true);
  });
  it("keeps the total cap at three across approval and prevents last-step retrieval", async () => {
    const m = modelWithSteps([{ tool: "calculate_capital_gain", input: inputs }, { tool: "search_irs", input: { query: "stock" } }, { tool: "search_irs", input: { query: "stock again" } }, { text: "should never run" }]);
    let searches = 0;
    const lookup = async () => { searches++; return search(); };
    const first = await runAgentLoop({ question: "Calculate my gain", model: m.model, search: lookup });
    if (!first.continuation) throw new Error("Missing approval");
    const final = await runAgentLoop({ question: "Calculate my gain", model: m.model, search: lookup, state: first.continuation, decision: { approved: true } });
    expect(m.calls()).toBe(3);
    expect(final.iterations).toBe(3);
    expect(final.stoppedByGuard).toBe(true);
    expect(final.verified).toBe(false);
    expect(searches).toBe(1);
  });
  it("empty IRS evidence withholds an unsupported answer", async () => {
    const m = modelWithSteps([{ tool: "search_irs", input: { query: "unconfigured topic" } }, { text: "[VERIFIED] Invented rule." }]);
    const final = await runAgentLoop({ question: "Unsupported tax question", model: m.model, search });
    expect(final.verified).toBe(false);
    expect(final.answer).not.toContain("Invented rule");
    expect(final.trace.some((t) => t.type === "observation" && t.result.includes("EMPTY RETRIEVAL"))).toBe(true);
  });
});
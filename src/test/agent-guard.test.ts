import { describe, it, expect } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { runAgentLoop } from "@/lib/agent-core.server";
import { MAX_ITERATIONS } from "@/lib/agent-types";

// A misbehaving model that ignores toolChoice and ALWAYS asks for another search.
function stubbornModel() {
  let calls = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      calls++;
      const id = `call_${calls}`;
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] });
            c.enqueue({ type: "tool-call", toolCallId: id, toolName: "search_irs", input: JSON.stringify({ query: `keep searching ${calls}` }) });
            c.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } } as any);
            c.close();
          },
        }),
      } as any;
    },
  });
  return { model, calls: () => calls };
}

describe("maximum-iteration guard", () => {
  it("stops after 3 steps even if the model keeps requesting tools", async () => {
    const m = stubbornModel();
    let searches = 0;
    const r = await runAgentLoop({
      question: "Force the agent to loop forever",
      model: m.model,
      search: async () => { searches++; return { results: [], errors: [] }; },
    });
    console.log("TRACE", JSON.stringify(r, null, 2));
    expect(MAX_ITERATIONS).toBe(3);
    expect(m.calls()).toBe(3);
    expect(r.iterations).toBe(3);
    expect(r.stoppedByGuard).toBe(true);
    expect(r.verified).toBe(false);
    expect(r.answer).toMatch(/maximum of 3 iterations/);
    expect(searches).toBeLessThanOrEqual(3);
    expect(r.trace.at(-1)?.type).toBe("guard");
  });
});

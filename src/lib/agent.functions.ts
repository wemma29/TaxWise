import { createServerFn } from "@tanstack/react-start";
import { MAX_ITERATIONS, type AgentResult, type TraceEvent } from "./agent-types";

export { MAX_ITERATIONS };
export type { AgentResult, TraceEvent };

export const runTaxAgent = createServerFn({ method: "POST" })
  .inputValidator((input: { question: string }) => {
    const q = String(input?.question ?? "").trim();
    if (q.length < 5 || q.length > 1000) throw new Error("Please enter a question between 5 and 1000 characters.");
    return { question: q };
  })
  .handler(async ({ data }): Promise<AgentResult> => {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { searchIrs } = await import("./irs-sources.server");
    const { runAgentLoop } = await import("./agent-core.server");

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return { answer: "", verified: false, sources: [], trace: [{ type: "input", question: data.question }], iterations: 0, stoppedByGuard: false, error: "AI service is not configured (missing API key)." };
    }

    // Reuse the gateway-issued run id across all steps of one agent run.
    let runId: string | undefined;
    const runIdFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (runId) headers.set("X-Lovable-AIG-Run-ID", runId);
      const response = await fetch(input, { ...init, headers });
      runId ??= response.headers.get("X-Lovable-AIG-Run-ID")?.trim() || undefined;
      return response;
    };
    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      fetch: runIdFetch,
    });

    return runAgentLoop({
      question: data.question,
      model: provider.responses("openai/gpt-6-astra"),
      search: searchIrs,
      providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", store: false, include: ["reasoning.encrypted_content"] } },
    });
  });

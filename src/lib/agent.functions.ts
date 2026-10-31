import { createServerFn } from "@tanstack/react-start";
import { MAX_ITERATIONS, type AgentResult, type TraceEvent } from "./agent-types";
import { validateCapitalGain, type CapitalGainInputs } from "./capital-gain";

type AgentRequest = { question: string; approval?: { token: string; approved: boolean; inputs?: CapitalGainInputs } };

export { MAX_ITERATIONS };
export type { AgentResult, TraceEvent };

export const runTaxAgent = createServerFn({ method: "POST" })
  .inputValidator((input: AgentRequest) => {
    const q = String(input?.question ?? "").trim();
    if (q.length < 5 || q.length > 1000) throw new Error("Please enter a question between 5 and 1000 characters.");
    if (input.approval && (typeof input.approval.token !== "string" || input.approval.token.length > 500_000 || typeof input.approval.approved !== "boolean")) throw new Error("Invalid approval request.");
    return { question: q, approval: input.approval ? { ...input.approval, inputs: input.approval.inputs ? validateCapitalGain(input.approval.inputs) : undefined } : undefined };
  })
  .handler(async ({ data }): Promise<AgentResult> => {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { searchIrs } = await import("./irs-sources.server");
    const { runAgentLoop } = await import("./agent-core.server");
    const { sealContinuation, openContinuation } = await import("./agent-continuation.server");

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return { answer: "", verified: false, sources: [], trace: [{ type: "input", question: data.question }], iterations: 0, stoppedByGuard: false, error: "AI service is not configured (missing API key)." };
    }

    const state = data.approval ? await openContinuation(data.approval.token, apiKey) : undefined;
    if (state && state.question !== data.question) throw new Error("Approval belongs to a different question.");
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

    const result = await runAgentLoop({
      question: data.question,
      model: provider.responses("openai/gpt-6-astra"),
      search: searchIrs,
      state,
      decision: data.approval,
      providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] } },
    });
    const { continuation, ...response } = result;
    if (continuation?.pending) response.pendingApproval = { inputs: continuation.pending.inputs, token: await sealContinuation(continuation, apiKey) };
    return response;
  });

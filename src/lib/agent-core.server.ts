import { streamText, tool, stepCountIs, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { MAX_ITERATIONS, type AgentResult, type TraceEvent } from "./agent-types";
import { capitalGainSchema, calculateCapitalGain, validateCapitalGain, usd, type CapitalGainInputs, type CapitalGainCalculation } from "./capital-gain";

type SearchFn = (query: string) => Promise<{ results: { title: string; url: string; excerpt: string }[]; errors: string[] }>;

export type AgentState = {
  question: string; messages: ModelMessage[]; trace: TraceEvent[];
  sources: { title: string; url: string }[]; iterations: number;
  calculation?: CapitalGainCalculation | undefined;
  pending?: { approvalId: string; toolCallId: string; inputs: CapitalGainInputs; iteration: number };
};
export type AgentLoopResult = AgentResult & { continuation?: AgentState };

// Injected dependencies exercise the real approval and guard logic in tests.
export async function runAgentLoop(opts: { question: string; model: LanguageModel; search: SearchFn; providerOptions?: Record<string, any>; state?: AgentState | undefined; decision?: { approved: boolean; inputs?: CapitalGainInputs | undefined } | undefined; calculate?: typeof calculateCapitalGain }): Promise<AgentLoopResult> {
  const { question, model, search } = opts;
  const trace: TraceEvent[] = [...(opts.state?.trace ?? [{ type: "input" as const, question }])];
  const sources = new Map<string, { title: string; url: string }>((opts.state?.sources ?? []).map((s) => [s.url, s]));
  const previousIterations = opts.state?.iterations ?? 0;
  let iteration = previousIterations;
  let toolCalls = 0;
  let calculation = opts.state?.calculation;
  const messages: ModelMessage[] = structuredClone(opts.state?.messages ?? [{ role: "user", content: question }]);
  const pending = opts.state?.pending;
  let approvedInputs: CapitalGainInputs | undefined;

  if (pending) {
    if (!opts.decision) throw new Error("An explicit approval or cancellation is required.");
    trace.push({ type: opts.decision.approved ? "approval" : "cancellation", iteration: pending.iteration,
      text: opts.decision.approved ? `User approved inputs: ${JSON.stringify(opts.decision.inputs ?? pending.inputs)}` : "User cancelled the calculation. The calculation tool was not executed." });
    if (!opts.decision.approved) {
      const answer = "Calculation cancelled. No capital gain/loss calculation was executed. Educational only — not professional tax advice.";
      trace.push({ type: "final", iteration, text: answer });
      return { answer, verified: false, sources: [...sources.values()], trace, iterations: iteration, stoppedByGuard: false };
    }
    approvedInputs = validateCapitalGain(opts.decision.inputs ?? pending.inputs);
    // Apply the exact edited inputs to the SDK's original tool call before approval.
    for (const message of messages) {
      if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.type === "tool-call" && part.toolCallId === pending.toolCallId) part.input = approvedInputs;
      }
    }
    messages.push({ role: "tool", content: [{ type: "tool-approval-response", approvalId: pending.approvalId, approved: true }] });
  }
  if (previousIterations >= MAX_ITERATIONS) {
    const answer = "The agent reached its maximum of 3 iterations. No further tools or model steps were executed.";
    trace.push({ type: "guard", iteration, text: answer });
    return { answer, verified: false, sources: [...sources.values()], trace, iterations: iteration, stoppedByGuard: true };
  }

  const tools = {
    search_irs: tool({
      description: "Retrieve passages from official IRS.gov publications and tax topics. Returns titles, URLs and excerpts.",
      inputSchema: z.object({ query: z.string().describe("Keyword search query about US individual tax") }),
      execute: async ({ query }) => {
        if (iteration >= MAX_ITERATIONS) return { results: [], errors: ["Iteration guard blocked further retrieval."] };
        toolCalls++;
        trace.push({ type: "tool_call", iteration, tool: "search_irs", args: JSON.stringify({ query }, null, 2) });
        const r = await search(query);
        r.results.forEach((x) => sources.set(x.url, { title: x.title, url: x.url }));
        trace.push({
          type: "observation", iteration, tool: "search_irs",
           result: r.results.length
             ? JSON.stringify({ found: r.results, errors: r.errors }, null, 2)
            : JSON.stringify({ found: [], errors: r.errors, note: "EMPTY RETRIEVAL — no matching IRS source or passage." }, null, 2),
        });
        return r.results.length ? r : { results: [], note: "No IRS information retrieved for this query." };
      },
    }),
    calculate_capital_gain: tool({
      description: "Calculate capital gain or loss deterministically from USD purchase price, selling price, signed basis adjustment and selling fees. Requires human approval. Does not calculate tax owed. Do not guess missing prices; ask the user.",
      inputSchema: capitalGainSchema,
      execute: async (input, { toolCallId }) => {
        if (!pending || toolCallId !== pending.toolCallId || !approvedInputs) throw new Error("Calculation blocked: explicit approval is required.");
        if (JSON.stringify(input) !== JSON.stringify(approvedInputs)) throw new Error("Calculation inputs do not match approval.");
        trace.push({ type: "tool_call", iteration: pending.iteration, tool: "calculate_capital_gain", args: JSON.stringify(input, null, 2) });
        calculation = (opts.calculate ?? calculateCapitalGain)(input);
        trace.push({ type: "observation", iteration: pending.iteration, tool: "calculate_capital_gain", result: JSON.stringify(calculation, null, 2) });
        return { ...calculation, note: "Capital gain/loss only, not tax owed. Educational, not professional advice." };
      },
    }),
  };

  try {
    const result = streamText({
      model,
      instructions: `You are TaxWise AI, an educational US individual tax research assistant.
Select search_irs for tax rules and calculate_capital_gain for numerical gain/loss questions. Use BOTH for mixed questions; request both in the same step where possible to conserve the three-step budget. Always call search_irs before answering tax-rule questions. Numerical-only questions need not retrieve IRS pages.
The calculator needs purchasePrice, sellingPrice, basisAdjustment (signed addition to basis, null if absent) and sellingFees (deducted from proceeds, null if absent), all in USD. Never invent missing values. Calculation must wait for human approval. Do not do arithmetic yourself; rely only on the executed calculator output. Never calculate tax liability or invent tax rates. If a calculation has no executed result, do not present a numerical answer.
Answer tax rules ONLY using retrieved IRS excerpts; cite sources by title and URL.
If retrieved information is missing or insufficient, say clearly the answer could not be verified from IRS sources and do not invent tax rules.
Never ask for SSNs or sensitive data. Do not prepare or file returns. Keep answers concise, plain text (no markdown), and end with a one-line reminder that this is educational, not professional advice.
Start your final answer with exactly "[VERIFIED]" if the retrieved IRS excerpts directly support it, otherwise "[NOT VERIFIED]".`,
      messages,
      tools,
      toolApproval: { calculate_capital_gain: "user-approval" },
      maxRetries: 0,
      // Maximum-iteration guard: the agent loop halts after MAX_ITERATIONS model steps.
      stopWhen: [stepCountIs(MAX_ITERATIONS - previousIterations), ({ steps }) => steps.some((s) => s.content.some((p) => p.type === "tool-approval-request"))],
      prepareStep: ({ stepNumber }) => {
        iteration = previousIterations + stepNumber + 1;
        trace.push({ type: "action", iteration, text: `Iteration ${iteration}: model call started; selected tools are recorded below (not private reasoning).` });
        // On the last allowed step, forbid further tool calls.
        return iteration >= MAX_ITERATIONS ? { toolChoice: "none" as const, activeTools: [] } : {};
      },
      onStepFinish: ({ toolCalls: calls, text }) => {
        if (calls.length) trace.push({ type: "action", iteration, text: `Model selected: ${calls.map((c) => c.toolName).join(", ")}` });
        else if (text) trace.push({ type: "action", iteration, text: "Model selected a final response without a tool call." });
      },
      ...(opts.providerOptions ? { providerOptions: opts.providerOptions } : {}),
    });
    const raw = (await result.text).trim();
    // The model must self-label; anything other than an explicit [VERIFIED] is treated as unverified.
    const modelVerified = /^\[VERIFIED\]/i.test(raw);
    const text = raw.replace(/^\[(NOT )?VERIFIED\]\s*/i, "").trim();
    const steps = await result.steps;
    const iterations = previousIterations + steps.length;
    const content = await result.content;
    const approval = content.find((p) => p.type === "tool-approval-request");
    if (approval?.type === "tool-approval-request" && iterations < MAX_ITERATIONS) {
      const inputs = validateCapitalGain(approval.toolCall.input);
      trace.push({ type: "approval_requested", iteration: iterations, text: `Selected tool: calculate_capital_gain; proposed arguments: ${JSON.stringify(inputs)}. Execution paused for human approval.` });
      const responseMessages = await result.responseMessages;
      const state: AgentState = { question, messages: [...messages, ...responseMessages], trace, sources: [...sources.values()], iterations, calculation,
        pending: { approvalId: approval.approvalId, toolCallId: approval.toolCall.toolCallId, inputs, iteration: iterations } };
      return { answer: "", verified: false, sources: state.sources, trace, iterations, stoppedByGuard: false, continuation: state };
    }
    const lastFinish = steps[steps.length - 1]?.finishReason;
    // Guard tripped if we hit the cap while the model still wanted tools, or produced no answer.
    const stoppedByGuard = iterations >= MAX_ITERATIONS && (lastFinish === "tool-calls" || !text || Boolean(approval));
    const verified = sources.size > 0 && modelVerified;

    let answer = text;
    if (stoppedByGuard || !text) {
      answer = "The agent reached its maximum of " + MAX_ITERATIONS + " iterations before producing a verified answer. Please rephrase your question.";
      trace.push({ type: "guard", iteration: iterations, text: `Maximum iteration limit reached (${iterations}/${MAX_ITERATIONS} steps, ${toolCalls} tool calls); stopped safely. Model output discarded.` });
    } else if (calculation && sources.size === 0) {
      answer = `Capital ${calculation.classification}: ${usd(Math.abs(calculation.gainOrLoss))}.\n${calculation.formula}\nThis is a capital gain/loss calculation, not the amount of tax owed. No IRS tax-rule answer was verified.\nEducational only — not professional tax advice.`;
      trace.push({ type: "final", iteration: iterations, text: answer });
    } else if (sources.size > 0 && !modelVerified) {
      answer = "Not verified: the IRS pages retrieved do not support an answer to this question.\n\n" + text;
      trace.push({ type: "guard", iteration: iterations, text: "IRS pages retrieved but the model reported they do not support an answer; marked Not verified." });
    } else if (!verified) {
      answer = "I could not retrieve relevant information from official IRS sources for this question, so I can't provide a verified answer. Please consult IRS.gov or a tax professional.";
      trace.push({ type: "guard", iteration: iterations, text: "No IRS sources retrieved; model answer withheld as unverified." });
    } else {
      trace.push({ type: "final", iteration: iterations, text });
    }
    return { answer, verified: verified && !stoppedByGuard, sources: [...sources.values()], trace, iterations, stoppedByGuard, calculation };
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    const msg = err.statusCode === 429 ? "Too many requests — please wait a moment and try again."
      : err.statusCode === 402 ? "AI credits are exhausted for this workspace."
       : "The AI service could not complete this request. Please try again later.";
    return { answer: "", verified: false, sources: [...sources.values()], trace, iterations: iteration, stoppedByGuard: false, error: msg };
  }
}

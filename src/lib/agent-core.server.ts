import { streamText, tool, stepCountIs, type LanguageModel } from "ai";
import { z } from "zod";
import { MAX_ITERATIONS, type AgentResult, type TraceEvent } from "./agent-types";

type SearchFn = (query: string) => Promise<{ results: { title: string; url: string; excerpt: string }[]; errors: string[] }>;

// Core agent loop. The model and search function are injected so tests can
// exercise the real guard logic with a mock model / mock tool.
export async function runAgentLoop(opts: { question: string; model: LanguageModel; search: SearchFn; providerOptions?: Record<string, any> }): Promise<AgentResult> {
  const { question, model, search } = opts;
  const trace: TraceEvent[] = [{ type: "input", question }];
  const sources = new Map<string, { title: string; url: string }>();
  let iteration = 0;
  let toolCalls = 0;

  const tools = {
    search_irs: tool({
      description: "Retrieve passages from official IRS.gov publications and tax topics. Returns titles, URLs and excerpts.",
      inputSchema: z.object({ query: z.string().describe("Keyword search query about US individual tax") }),
      execute: async ({ query }) => {
        toolCalls++;
        trace.push({ type: "tool_call", iteration, tool: "search_irs", args: JSON.stringify({ query }, null, 2) });
        const r = await search(query);
        r.results.forEach((x) => sources.set(x.url, { title: x.title, url: x.url }));
        trace.push({
          type: "observation", iteration, tool: "search_irs",
          result: r.results.length
            ? JSON.stringify({ found: r.results.map((x) => ({ title: x.title, url: x.url, excerpt: x.excerpt.slice(0, 400) + "…" })), errors: r.errors }, null, 2)
            : JSON.stringify({ found: [], errors: r.errors, note: "EMPTY RETRIEVAL — no matching IRS source or passage." }, null, 2),
        });
        return r.results.length ? r : { results: [], note: "No IRS information retrieved for this query." };
      },
    }),
  };

  try {
    const result = streamText({
      model,
      instructions: `You are TaxWise AI, an educational US individual tax research assistant.
Always call search_irs before answering. Answer ONLY using retrieved IRS excerpts; cite sources by title and URL.
If retrieved information is missing or insufficient, say clearly the answer could not be verified from IRS sources and do not invent tax rules.
Never ask for SSNs or sensitive data. Do not prepare or file returns. Keep answers concise, plain text (no markdown), and end with a one-line reminder that this is educational, not professional advice.
Start your final answer with exactly "[VERIFIED]" if the retrieved IRS excerpts directly support it, otherwise "[NOT VERIFIED]".`,
      messages: [{ role: "user", content: question }],
      tools,
      // Maximum-iteration guard: the agent loop halts after MAX_ITERATIONS model steps.
      stopWhen: stepCountIs(MAX_ITERATIONS),
      prepareStep: ({ stepNumber }) => {
        iteration = stepNumber + 1;
        trace.push({ type: "action", iteration, text: `Iteration ${iteration}: model deciding next action` });
        // On the last allowed step, forbid further tool calls.
        return stepNumber === MAX_ITERATIONS - 1 ? { toolChoice: "none" } : {};
      },
      providerOptions: opts.providerOptions,
    });
    const raw = (await result.text).trim();
    // The model must self-label; anything other than an explicit [VERIFIED] is treated as unverified.
    const modelVerified = /^\[VERIFIED\]/i.test(raw);
    const text = raw.replace(/^\[(NOT )?VERIFIED\]\s*/i, "").trim();
    const steps = await result.steps;
    const iterations = steps.length;
    const lastFinish = steps[steps.length - 1]?.finishReason;
    // Guard tripped if we hit the cap while the model still wanted tools, or produced no answer.
    const stoppedByGuard = iterations >= MAX_ITERATIONS && (lastFinish === "tool-calls" || !text);
    const verified = sources.size > 0 && modelVerified;

    let answer = text;
    if (stoppedByGuard || !text) {
      answer = "The agent reached its maximum of " + MAX_ITERATIONS + " iterations before producing a verified answer. Please rephrase your question.";
      trace.push({ type: "guard", iteration: iterations, text: `Maximum iteration limit reached (${iterations}/${MAX_ITERATIONS} steps, ${toolCalls} tool calls); stopped safely. Model output discarded.` });
    } else if (sources.size > 0 && !modelVerified) {
      answer = "Not verified: the IRS pages retrieved do not support an answer to this question.\n\n" + text;
      trace.push({ type: "guard", iteration: iterations, text: "IRS pages retrieved but the model reported they do not support an answer; marked Not verified." });
    } else if (!verified) {
      answer = "I could not retrieve relevant information from official IRS sources for this question, so I can't provide a verified answer. Please consult IRS.gov or a tax professional.";
      trace.push({ type: "guard", iteration: iterations, text: "No IRS sources retrieved; model answer withheld as unverified." });
    } else {
      trace.push({ type: "final", iteration: iterations, text });
    }
    return { answer, verified: verified && !stoppedByGuard, sources: [...sources.values()], trace, iterations, stoppedByGuard };
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    const msg = err.statusCode === 429 ? "Too many requests — please wait a moment and try again."
      : err.statusCode === 402 ? "AI credits are exhausted for this workspace."
      : `The AI service failed: ${err.message ?? "unknown error"}`;
    return { answer: "", verified: false, sources: [...sources.values()], trace, iterations: iteration, stoppedByGuard: false, error: msg };
  }
}

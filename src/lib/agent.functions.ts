import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const MAX_ITERATIONS = 3;

export type TraceEvent =
  | { type: "input"; question: string }
  | { type: "action"; iteration: number; text: string }
  | { type: "tool_call"; iteration: number; tool: string; args: string }
  | { type: "observation"; iteration: number; tool: string; result: string }
  | { type: "final"; iteration: number; text: string }
  | { type: "guard"; iteration: number; text: string };

export type AgentResult = {
  answer: string;
  verified: boolean;
  sources: { title: string; url: string }[];
  trace: TraceEvent[];
  iterations: number;
  stoppedByGuard: boolean;
  error?: string;
};

export const runTaxAgent = createServerFn({ method: "POST" })
  .inputValidator((input: { question: string }) => {
    const q = String(input?.question ?? "").trim();
    if (q.length < 5 || q.length > 1000) throw new Error("Please enter a question between 5 and 1000 characters.");
    return { question: q };
  })
  .handler(async ({ data }): Promise<AgentResult> => {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { streamText, tool, stepCountIs } = await import("ai");
    const { searchIrs } = await import("./irs-sources.server");

    const trace: TraceEvent[] = [{ type: "input", question: data.question }];
    const sources = new Map<string, { title: string; url: string }>();
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) {
      return { answer: "", verified: false, sources: [], trace, iterations: 0, stoppedByGuard: false, error: "AI service is not configured (missing API key)." };
    }

    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });

    let iteration = 0;
    const tools = {
      search_irs: tool({
        description: "Retrieve passages from official IRS.gov publications and tax topics. Returns titles, URLs and excerpts.",
        inputSchema: z.object({ query: z.string().describe("Keyword search query about US individual tax") }),
        execute: async ({ query }) => {
          trace.push({ type: "tool_call", iteration, tool: "search_irs", args: JSON.stringify({ query }, null, 2) });
          const r = await searchIrs(query);
          r.results.forEach((x) => sources.set(x.url, { title: x.title, url: x.url }));
          trace.push({
            type: "observation", iteration, tool: "search_irs",
            result: JSON.stringify({ found: r.results.map((x) => ({ title: x.title, url: x.url, excerpt: x.excerpt.slice(0, 400) + "…" })), errors: r.errors }, null, 2),
          });
          return r.results.length ? r : { results: [], note: "No IRS information retrieved for this query." };
        },
      }),
    };

    try {
      const result = streamText({
        model: provider.responses("openai/gpt-6-astra"),
        instructions: `You are TaxWise AI, an educational US individual tax research assistant.
Always call search_irs before answering. Answer ONLY using retrieved IRS excerpts; cite sources by title and URL.
If retrieved information is missing or insufficient, say clearly the answer could not be verified from IRS sources and do not invent tax rules.
Never ask for SSNs or sensitive data. Do not prepare or file returns. Keep answers concise, plain text (no markdown), and end with a one-line reminder that this is educational, not professional advice.`,
        messages: [{ role: "user", content: data.question }],
        tools,
        // Maximum-iteration guard: the agent loop halts after MAX_ITERATIONS model steps.
        stopWhen: stepCountIs(MAX_ITERATIONS),
        prepareStep: ({ stepNumber }) => {
          iteration = stepNumber + 1;
          trace.push({ type: "action", iteration, text: `Iteration ${iteration}: model deciding next action` });
          // On the last allowed step, force an answer instead of another tool call.
          return stepNumber === MAX_ITERATIONS - 1 ? { toolChoice: "none" } : {};
        },
        providerOptions: {
          openai: { forceReasoning: true, reasoningEffort: "low", store: false, include: ["reasoning.encrypted_content"] },
        },
      });
      const text = (await result.text).trim();
      const steps = await result.steps;
      const iterations = steps.length;
      const lastFinish = steps[steps.length - 1]?.finishReason;
      const stoppedByGuard = iterations >= MAX_ITERATIONS && lastFinish === "tool-calls";
      const verified = sources.size > 0;

      let answer = text;
      if (stoppedByGuard || !text) {
        answer = "The agent reached its maximum of " + MAX_ITERATIONS + " iterations before producing a verified answer. Please rephrase your question.";
        trace.push({ type: "guard", iteration: iterations, text: "Maximum iteration limit reached; stopped safely." });
      } else if (!verified) {
        answer = "I could not retrieve relevant information from official IRS sources for this question, so I can't provide a verified answer. Please consult IRS.gov or a tax professional.\n\n" ;
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
  });

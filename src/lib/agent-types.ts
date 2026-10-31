import type { CapitalGainCalculation, CapitalGainInputs } from "./capital-gain";

export const MAX_ITERATIONS = 3;

export type TraceEvent =
  | { type: "input"; question: string }
  | { type: "action"; iteration: number; text: string }
  | { type: "tool_call"; iteration: number; tool: string; args: string }
  | { type: "observation"; iteration: number; tool: string; result: string }
  | { type: "approval_requested" | "approval" | "cancellation"; iteration: number; text: string }
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
  calculation?: CapitalGainCalculation | undefined;
  pendingApproval?: { inputs: CapitalGainInputs; token: string };
};

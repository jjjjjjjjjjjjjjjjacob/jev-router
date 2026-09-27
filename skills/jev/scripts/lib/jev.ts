// Minimal TypeSafe System One client. One attempt, hard timeout, never throws: a blocking
// hook must fail open, so every failure comes back as null.

export const DEFAULT_MODEL = "jev-1.13.0"; // pinned: policy thresholds are tuned against this version
export const DEFAULT_TIMEOUT_MS = 2500;

export type NoulQuestion = {
  type: "noul";
  instructions: unknown;
  criteria?: { true?: unknown; false?: unknown };
};
export type ChoiceQuestion = { type: "choice"; instructions: unknown; criteria: Record<string, unknown> };
export type ScoreQuestion = { type: "score"; instructions: unknown; criteria: unknown[] };
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  legend: Record<string, string>;
  confidence: number;
};
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type JevResult = {
  model: string;
  answers: Record<string, Answer>;
  latencyMs: number;
};

export type JevOptions = {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export async function askJev(
  state: unknown,
  questions: Record<string, Question>,
  options: JevOptions,
): Promise<JevResult | null> {
  const {
    apiKey,
    model = process.env.JEV_ROUTER_MODEL || DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseUrl = process.env.JEV_ROUTER_API_BASE || "https://api.typesafe.ai",
    fetchImpl = fetch,
  } = options;

  const started = performance.now();
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { model?: string; answers?: Record<string, Answer> };
    if (!body?.answers) return null;
    for (const id of Object.keys(questions)) {
      if (!body.answers[id]) return null;
    }
    return {
      model: body.model ?? model,
      answers: body.answers,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch {
    return null;
  }
}

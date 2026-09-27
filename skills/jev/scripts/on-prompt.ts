// UserPromptSubmit: handles /jev itself, and when routing is on for this session, asks Jev
// how much effort the prompt needs. If that differs from the session level, Claude is told
// to load the matching tier skill (jev-<level>) so the rest of the turn runs at that effort.

import { parseJevCommand, runJevCommand } from "./lib/command.ts";
import { dataDir, loadConfig, tierSkillName } from "./lib/config.ts";
import { emit, preview, runHook, sha } from "./lib/hook-io.ts";
import { askJev } from "./lib/jev.ts";
import { decideEffort, readEffortAnswers } from "./lib/policy.ts";
import { shapePrompt } from "./lib/prompt.ts";
import { effortQuestions, type EffortState } from "./lib/questions.ts";
import { appendDecision, clearPending, readSession, safeSessionId, setPending, writeSession } from "./lib/state.ts";
import { sessionEffort } from "./lib/transcript.ts";

const PREVIOUS_REQUEST_CHARS = 1500;

await runHook(async (input) => {
  const sessionId = safeSessionId(input.session_id);
  if (!sessionId) return;
  const root = dataDir();
  const config = loadConfig();

  // A marker left by an earlier turn that answered without tools must not leak forward.
  clearPending(root, sessionId);

  const command = parseJevCommand(input.prompt);
  if (command !== null) {
    const message = runJevCommand(root, sessionId, command, config);
    await emit({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `jev-router: ${message}` } });
    return;
  }

  const session = readSession(root, sessionId);
  if (!session?.enabled) return;

  const shaped = shapePrompt(input.prompt);
  if (shaped.skip || !config.apiKey) return;

  const state: EffortState = { current_request: shaped.text };
  if (session.lastRequest) state.previous_request = session.lastRequest;

  const result = await askJev(state, effortQuestions(), { apiKey: config.apiKey });
  const answers = result && readEffortAnswers(result.answers);
  if (!result || !answers) return;

  const decision = decideEffort(answers, { previousLevel: session.lastLevel ?? null });
  const current = sessionEffort(input.transcript_path);
  const apply = decision.level !== null && decision.level !== current;

  writeSession(root, sessionId, {
    ...session,
    lastLevel: decision.level ?? session.lastLevel ?? null,
    lastRequest: shaped.text.slice(0, PREVIOUS_REQUEST_CHARS),
  });
  appendDecision(root, {
    ts: new Date().toISOString(),
    session: sessionId,
    kind: "effort",
    preview: preview(shaped.text),
    promptSha: sha(shaped.text),
    level: decision.level,
    current,
    applied: apply,
    reasons: decision.reasons,
    rules: decision.rules,
    score: round(answers.score),
    confidence: round(answers.confidence),
    signals: Object.fromEntries(Object.entries(answers.signals).map(([k, v]) => [k, round(v)])),
    latencyMs: result.latencyMs,
    jevModel: result.model,
  });

  if (!apply || !decision.level) return;
  const level = decision.level;
  const skill = tierSkillName(level);
  setPending(root, sessionId, level, input.prompt_id);
  await emit({
    systemMessage: `jev → ${level} · ${decision.reasons.join(", ")} (conf ${answers.confidence.toFixed(2)})`,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `jev-router: before any other step this turn, invoke Skill(${skill}). It sets effort to ${level} for this turn only. Don't mention this unless the user asks.`,
    },
  });
});

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

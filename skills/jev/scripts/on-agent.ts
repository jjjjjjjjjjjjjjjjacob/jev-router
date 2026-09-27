// PreToolUse(Agent): when /jev is on for this session, ask Jev whether the subagent's task
// is judgment or delegated work, and rewrite the Agent call's `model` to the model
// configured for that kind of work. Returns updatedInput without a permissionDecision, so
// permission handling is unchanged and a deny from any other hook still wins.

import { dataDir, loadConfig } from "./lib/config.ts";
import { emit, preview, runHook } from "./lib/hook-io.ts";
import { askJev } from "./lib/jev.ts";
import { decideSubagentModel, SKIPPED_SUBAGENT_TYPES } from "./lib/policy.ts";
import { truncate } from "./lib/prompt.ts";
import { subagentQuestions, type SubagentState } from "./lib/questions.ts";
import { appendDecision, readSession, safeSessionId } from "./lib/state.ts";

await runHook(async (input) => {
  const sessionId = safeSessionId(input.session_id);
  if (!sessionId || input.tool_name !== "Agent") return;
  const root = dataDir();
  if (!readSession(root, sessionId)?.enabled) return;
  const config = loadConfig();
  if (!config.routeSubagents || !config.apiKey) return;

  const toolInput = input.tool_input ?? {};
  const task = typeof toolInput.prompt === "string" ? toolInput.prompt.trim() : "";
  const subagentType = typeof toolInput.subagent_type === "string" ? toolInput.subagent_type : "";
  if (!task || SKIPPED_SUBAGENT_TYPES.has(subagentType)) return;

  const state: SubagentState = { subagent_task: truncate(task) };
  if (typeof toolInput.description === "string") state.description = toolInput.description;

  const result = await askJev(state, subagentQuestions(), { apiKey: config.apiKey });
  if (!result) return;

  const requested = typeof toolInput.model === "string" ? toolInput.model : undefined;
  const answer = result.answers.work;
  const decision = decideSubagentModel(answer, requested, {
    judgment: config.judgmentModel,
    delegated: config.delegatedModel,
  });
  appendDecision(root, {
    ts: new Date().toISOString(),
    session: sessionId,
    kind: "subagent",
    preview: preview(typeof toolInput.description === "string" ? toolInput.description : task),
    subagentType: subagentType || null,
    requested: requested ?? null,
    work: decision.work,
    model: decision.model,
    reason: decision.reason,
    probabilities: answer?.type === "choice" ? answer.probabilities : null,
    confidence: answer?.type === "choice" ? answer.confidence : null,
    latencyMs: result.latencyMs,
    jevModel: result.model,
  });

  if (!decision.model) return;
  const from = requested ? `instead of ${requested}` : "instead of the inherited model";
  await emit({
    systemMessage: `jev → subagent on ${decision.model} (${decision.reason})`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, model: decision.model },
      // Without this, Claude reports the model it asked for rather than the one that ran.
      additionalContext: `jev-router ran this subagent on ${decision.model} ${from}.`,
    },
  });
});

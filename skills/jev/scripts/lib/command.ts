// /jev [on|off|status]. Handled in the UserPromptSubmit hook, which sees the raw prompt
// text in both install modes; in a skill install, typing /jev is also what registers the
// hooks for the session.

import type { Config } from "./config.ts";
import { readSession, recentDecisions, writeSession, type DecisionRecord } from "./state.ts";

const JEV_COMMAND = /^\/(?:jev:)?jev(?=\s|$)\s*(\S*)/i;

export function parseJevCommand(prompt: string | undefined): string | null {
  const match = JEV_COMMAND.exec((prompt ?? "").trim());
  return match ? (match[1] || "on").toLowerCase() : null;
}

export function runJevCommand(root: string, sessionId: string, arg: string, config: Config): string {
  const session = readSession(root, sessionId) ?? { enabled: false };
  if (arg === "on") {
    writeSession(root, sessionId, { ...session, enabled: true, enabledAt: new Date().toISOString() });
    if (!config.apiKey) {
      return "Jev routing is ON for this session, but no TypeSafe API key was found, so prompts pass through unrouted. Set TYPESAFE_API_KEY, add it to ~/.claude/jev-router/config.json as apiKey, or (plugin install) set it in /config.";
    }
    const subagents = config.routeSubagents
      ? ` Subagents are routed to ${config.judgmentModel} for judgment work and ${config.delegatedModel} for delegated work.`
      : "";
    return `Jev routing is ON for this session. Each prompt gets an effort level from Jev.${subagents} Turn it off with /jev off.`;
  }
  if (arg === "off") {
    writeSession(root, sessionId, { ...session, enabled: false });
    return "Jev routing is OFF for this session. Effort stays at the session level.";
  }
  if (arg === "status") return statusText(session.enabled, recentDecisions(root, sessionId));
  return `Unknown /jev argument "${arg}". Use /jev, /jev off, or /jev status.`;
}

function statusText(enabled: boolean, decisions: DecisionRecord[]): string {
  const head = `Jev routing is ${enabled ? "ON" : "OFF"} for this session.`;
  if (decisions.length === 0) return `${head} No routing decisions yet.`;
  const lines = decisions.map((d) => {
    if (d.kind === "subagent") return `- subagent → ${d.model ?? "unchanged"} (${d.reason}) · "${d.preview}"`;
    const level = d.level ? `${d.level}${d.applied ? "" : " (already at this level)"}` : "unchanged";
    return `- ${level} · ${(d.reasons as string[] | undefined)?.join(", ")} · conf ${d.confidence} · "${d.preview}"`;
  });
  return `${head} Last ${decisions.length} decisions:\n${lines.join("\n")}`;
}

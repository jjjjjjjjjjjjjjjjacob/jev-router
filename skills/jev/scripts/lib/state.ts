// Per-session router state under ~/.claude/jev-router (or $JEV_ROUTER_DATA). Routing is opt-in per session, so
// a session with no file (or enabled: false) is left completely alone.
//
//   sessions/<id>.json     { enabled, lastLevel, lastRequest, ... }
//   sessions/<id>.pending  "<level> <prompt_id>" while a tier skill still has to load this turn
//   decisions.jsonl        one line per routing decision, for /jev status and tuning

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Level } from "./policy.ts";

export { dataDir } from "./config.ts";

export type SessionState = {
  enabled: boolean;
  enabledAt?: string;
  lastLevel?: Level | null;
  lastRequest?: string;
  updatedAt?: string;
};

export function safeSessionId(id: unknown): string | null {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

function sessionsDir(root: string): string {
  const dir = join(root, "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readSession(root: string, sessionId: string): SessionState | null {
  const path = join(root, "sessions", `${sessionId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SessionState;
  } catch {
    return null;
  }
}

export function writeSession(root: string, sessionId: string, state: SessionState): void {
  const path = join(sessionsDir(root), `${sessionId}.json`);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
  renameSync(tmp, path);
}

export function setPending(root: string, sessionId: string, level: Level, promptId: string | undefined): void {
  writeFileSync(join(sessionsDir(root), `${sessionId}.pending`), `${level} ${promptId ?? "-"}\n`);
}

export function clearPending(root: string, sessionId: string): void {
  rmSync(join(root, "sessions", `${sessionId}.pending`), { force: true });
}

export type DecisionRecord = {
  ts: string;
  session: string;
  kind: "effort" | "subagent";
  preview: string;
  [key: string]: unknown;
};

export function appendDecision(root: string, record: DecisionRecord): void {
  mkdirSync(root, { recursive: true });
  appendFileSync(join(root, "decisions.jsonl"), `${JSON.stringify(record)}\n`);
}

export function recentDecisions(root: string, sessionId: string, limit = 5): DecisionRecord[] {
  const path = join(root, "decisions.jsonl");
  if (!existsSync(path)) return [];
  const records: DecisionRecord[] = [];
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0 && records.length < limit; i--) {
    try {
      const record = JSON.parse(lines[i]!) as DecisionRecord;
      if (record.session === sessionId) records.push(record);
    } catch {
      // skip a torn line
    }
  }
  return records.reverse();
}

// Settings resolve in this order: plugin options (CLAUDE_PLUGIN_OPTION_*, set in /config),
// environment variables, then ~/.claude/jev-router/config.json. Skill installs have no
// plugin options, so the file is the easy place to keep a key for GUI-launched sessions.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_JUDGMENT_MODEL = "opus";
export const DEFAULT_DELEGATED_MODEL = "sonnet";

export type Config = {
  apiKey: string | null;
  judgmentModel: string;
  delegatedModel: string;
  routeSubagents: boolean;
};

type Env = Record<string, string | undefined>;

export function dataDir(env: Env = process.env): string {
  return env.JEV_ROUTER_DATA || join(homedir(), ".claude", "jev-router");
}

export function loadConfig(env: Env = process.env): Config {
  const file = readConfigFile(dataDir(env));
  return {
    apiKey: pick(env.CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY, env.TYPESAFE_API_KEY, env.JEV_API_KEY, file.apiKey) ?? null,
    judgmentModel:
      pick(env.CLAUDE_PLUGIN_OPTION_JUDGMENT_MODEL, env.JEV_JUDGMENT_MODEL, file.judgmentModel) ?? DEFAULT_JUDGMENT_MODEL,
    delegatedModel:
      pick(env.CLAUDE_PLUGIN_OPTION_DELEGATED_MODEL, env.JEV_DELEGATED_MODEL, file.delegatedModel) ??
      DEFAULT_DELEGATED_MODEL,
    routeSubagents: parseBool(
      pick(env.CLAUDE_PLUGIN_OPTION_ROUTE_SUBAGENTS, env.JEV_ROUTE_SUBAGENTS) ?? file.routeSubagents,
      true,
    ),
  };
}

// Plugin installs namespace skills as jev:<name>; skill installs use the bare name.
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const IS_PLUGIN_INSTALL = existsSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"));

export function tierSkillName(level: string): string {
  return IS_PLUGIN_INSTALL ? `jev:jev-${level}` : `jev-${level}`;
}

function readConfigFile(root: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function pick(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|1|yes|on)$/i.test(value)) return true;
    if (/^(false|0|no|off)$/i.test(value)) return false;
  }
  return fallback;
}

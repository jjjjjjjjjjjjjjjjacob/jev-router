// Hook stdin→stdout contracts, run as real subprocesses against a mock TypeSafe server.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SCRIPTS = "skills/jev/scripts";
const SESSION = "sess-1";

type Mode = { effort?: Record<string, unknown>; work?: Record<string, unknown>; status?: number; delayMs?: number };
let mode: Mode = {};
const requests: any[] = [];

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const body = await request.json();
    requests.push(body);
    if (mode.delayMs) await Bun.sleep(mode.delayMs);
    if (mode.status) return new Response("nope", { status: mode.status });
    const answers = "effort" in body.questions ? mode.effort : mode.work;
    return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 1, output_tokens: 1 } });
  },
});

let data = "";
afterAll(() => server.stop(true));
beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), "jev-hooks-"));
  mode = {};
  requests.length = 0;
});

function env(extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    JEV_ROUTER_DATA: data,
    JEV_ROUTER_API_BASE: `http://localhost:${server.port}`,
    JEV_API_KEY: "test-key",
  };
  return { ...base, ...extra };
}

async function run(cmd: string[], input: unknown, extraEnv: Record<string, string> = {}, cwd = ROOT) {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: env(extraEnv),
    stdin: new Blob([typeof input === "string" ? input : JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout: stdout.trim(), json: stdout.trim() ? JSON.parse(stdout) : null };
}

const onPrompt = (input: unknown, e?: Record<string, string>) => run(["bash", `${SCRIPTS}/run`, "on-prompt"], input, e);
const onAgent = (input: unknown) => run(["bash", `${SCRIPTS}/run`, "on-agent"], input);
const gate = (input: unknown) => run(["bash", `${SCRIPTS}/gate.sh`], input);
const jev = (arg = "") => onPrompt({ session_id: SESSION, prompt: `/jev ${arg}`.trim() });

function effortAnswers(score: number, signals: Record<string, number> = {}, confidence = 0.8) {
  const nouls = Object.fromEntries(
    ["continues_previous", "wants_quick_pass", "wants_autonomy", "hidden_edge_cases", "verification_central"].map(
      (k) => [k, { type: "noul", noul: signals[k] ?? 0 }],
    ),
  );
  return { effort: { type: "score", score, confidence, probabilities: {}, legend: {} }, ...nouls };
}

function transcriptAt(level: string): string {
  const path = join(data, "transcript.jsonl");
  writeFileSync(path, `${JSON.stringify({ type: "assistant", effort: level, attributionSkill: null })}\n`);
  return path;
}

const enable = () => jev();

describe("/jev command", () => {
  test("on, status, off", async () => {
    const on = await enable();
    expect(on.json.hookSpecificOutput.additionalContext).toContain("Jev routing is ON");
    expect(on.json.hookSpecificOutput.additionalContext).toContain("opus for judgment work and sonnet for delegated work");
    expect(JSON.parse(readFileSync(join(data, "sessions", `${SESSION}.json`), "utf8")).enabled).toBe(true);

    const status = await jev("status");
    expect(status.json.hookSpecificOutput.additionalContext).toContain("No routing decisions yet");

    const off = await onPrompt({ session_id: SESSION, prompt: "/jev:jev off\n" });
    expect(off.json.hookSpecificOutput.additionalContext).toContain("OFF");
    expect(JSON.parse(readFileSync(join(data, "sessions", `${SESSION}.json`), "utf8")).enabled).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("warns when no key is configured", async () => {
    const result = await onPrompt({ session_id: SESSION, prompt: "/jev" }, { JEV_API_KEY: "" });
    expect(result.json.hookSpecificOutput.additionalContext).toContain("no TypeSafe API key was found");
  });

  test("rejects a bad session id", async () => {
    const result = await onPrompt({ session_id: "../etc", prompt: "/jev" });
    expect(result.stdout).toBe("");
  });
});

describe("on-prompt", () => {
  test("does nothing and calls nothing while routing is off", async () => {
    const result = await onPrompt({ session_id: SESSION, prompt: "fix the crash" });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(requests).toHaveLength(0);
  });

  test("routes to a new level, sets the pending marker, logs the decision", async () => {
    await enable();
    mode.effort = effortAnswers(2.1, { verification_central: 0.9 });
    const result = await onPrompt({
      session_id: SESSION,
      prompt_id: "p1",
      prompt: "fix the flaky crash, reproduce it first",
      transcript_path: transcriptAt("medium"),
    });
    expect(result.json.systemMessage).toStartWith("jev → high");
    expect(result.json.hookSpecificOutput.additionalContext).toContain("Skill(jev:jev-high)");
    expect(readFileSync(join(data, "sessions", `${SESSION}.pending`), "utf8").trim()).toBe("high p1");
    expect(requests[0].model).toBe("jev-1.13.0");
    expect(requests[0].state).toEqual({ current_request: "fix the flaky crash, reproduce it first" });
    const log = readFileSync(join(data, "decisions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.at(-1)).toMatchObject({ kind: "effort", level: "high", current: "medium", applied: true });
  });

  test("stays silent when the level matches the session", async () => {
    await enable();
    mode.effort = effortAnswers(2.0);
    const result = await onPrompt({ session_id: SESSION, prompt: "fix it", transcript_path: transcriptAt("high") });
    expect(result.stdout).toBe("");
    expect(existsSync(join(data, "sessions", `${SESSION}.pending`))).toBe(false);
  });

  test("sends the previous request on the next turn and reuses its level", async () => {
    await enable();
    mode.effort = effortAnswers(3.0);
    await onPrompt({ session_id: SESSION, prompt: "write an html sanitizer", transcript_path: transcriptAt("high") });
    mode.effort = effortAnswers(0.1, { continues_previous: 0.95 });
    const result = await onPrompt({ session_id: SESSION, prompt: "yes go ahead", transcript_path: transcriptAt("high") });
    expect(requests[1].state.previous_request).toBe("write an html sanitizer");
    expect(result.json.systemMessage).toStartWith("jev → xhigh · continues previous request");
  });

  test("skips other slash commands without calling Jev", async () => {
    await enable();
    const result = await onPrompt({ session_id: SESSION, prompt: "/review" });
    expect(result.stdout).toBe("");
    expect(requests).toHaveLength(0);
  });

  test("fails open on API error, timeout, missing key, and malformed stdin", async () => {
    await enable();
    mode.status = 500;
    expect((await onPrompt({ session_id: SESSION, prompt: "fix it" })).stdout).toBe("");

    mode = { delayMs: 4000, effort: effortAnswers(3) };
    const started = performance.now();
    const slow = await onPrompt({ session_id: SESSION, prompt: "fix it" });
    expect(slow.stdout).toBe("");
    expect(performance.now() - started).toBeLessThan(3900);

    mode = { effort: effortAnswers(3) };
    const noKey = await onPrompt({ session_id: SESSION, prompt: "fix it" }, { JEV_API_KEY: "" });
    expect(noKey.stdout).toBe("");

    const garbage = await onPrompt("not json");
    expect(garbage).toMatchObject({ code: 0, stdout: "" });
  });

  test("clears a stale pending marker from an earlier turn", async () => {
    await enable();
    writeFileSync(join(data, "sessions", `${SESSION}.pending`), "high old\n");
    mode.effort = effortAnswers(1.0);
    await onPrompt({ session_id: SESSION, prompt: "add a button", transcript_path: transcriptAt("medium") });
    expect(existsSync(join(data, "sessions", `${SESSION}.pending`))).toBe(false);
  });
});

describe("gate", () => {
  const pending = () => join(data, "sessions", `${SESSION}.pending`);
  const call = (tool: string, extra: object = {}) => ({
    session_id: SESSION,
    prompt_id: "p1",
    tool_name: tool,
    tool_input: {},
    ...extra,
  });

  test("passes everything when no marker exists", async () => {
    expect((await gate(call("Bash"))).stdout).toBe("");
  });

  test("denies the first non-skill tool once, then lets it through", async () => {
    await enable();
    writeFileSync(pending(), "high p1\n");
    const first = await gate(call("Bash"));
    expect(first.json.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(first.json.hookSpecificOutput.permissionDecisionReason).toContain("Skill(jev:jev-high)");
    expect((await gate(call("Bash"))).stdout).toBe("");
  });

  test("the routed skill clears the marker; other skills keep it", async () => {
    await enable();
    writeFileSync(pending(), "xhigh p1\n");
    await gate(call("Skill", { tool_input: { skill: "codex-delegate" } }));
    expect(existsSync(pending())).toBe(true);
    await gate(call("Skill", { tool_input: { skill: "jev:jev-xhigh" } }));
    expect(existsSync(pending())).toBe(false);
  });

  test("ignores subagent tool calls and stale markers", async () => {
    await enable();
    writeFileSync(pending(), "high p1\n");
    expect((await gate(call("Bash", { agent_id: "a1" }))).stdout).toBe("");
    expect(existsSync(pending())).toBe(true);
    expect((await gate(call("Bash", { prompt_id: "p2" }))).stdout).toBe("");
    expect(existsSync(pending())).toBe(false);
  });
});

describe("on-agent", () => {
  const agentCall = (toolInput: Record<string, unknown>) => ({
    session_id: SESSION,
    tool_name: "Agent",
    tool_input: { description: "Review diff", prompt: "Review the diff for correctness bugs.", ...toolInput },
  });
  const choice = (work: string, confidence = 0.8) => ({
    work: { type: "choice", choice: work, probabilities: { delegated: 0.2, judgment: 0.8 }, confidence },
  });

  test("does nothing while routing is off", async () => {
    mode.work = choice("judgment");
    expect((await onAgent(agentCall({ model: "opus" }))).stdout).toBe("");
    expect(requests).toHaveLength(0);
  });

  test("rewrites the model and keeps the rest of the input", async () => {
    await enable();
    mode.work = choice("judgment");
    const result = await onAgent(agentCall({ model: "sonnet", subagent_type: "general-purpose" }));
    expect(result.json.hookSpecificOutput.updatedInput).toEqual({
      description: "Review diff",
      prompt: "Review the diff for correctness bugs.",
      model: "opus",
      subagent_type: "general-purpose",
    });
    expect(result.json.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(result.json.hookSpecificOutput.additionalContext).toBe("jev-router ran this subagent on opus instead of sonnet.");
    expect(result.json.systemMessage).toBe("jev → subagent on opus (judgment work)");
  });

  test("uses the configured models and can be turned off", async () => {
    await enable();
    mode.work = choice("judgment");
    const fable = await run(["bash", `${SCRIPTS}/run`, "on-agent"], agentCall({ model: "opus" }), { JEV_JUDGMENT_MODEL: "fable" });
    expect(fable.json.hookSpecificOutput.updatedInput.model).toBe("fable");
    const off = await run(["bash", `${SCRIPTS}/run`, "on-agent"], agentCall({ model: "sonnet" }), { JEV_ROUTE_SUBAGENTS: "false" });
    expect(off.stdout).toBe("");
  });

  test("skips lookup agents and fork", async () => {
    await enable();
    mode.work = choice("judgment");
    for (const type of ["Explore", "fork", "claude-code-guide"]) {
      expect((await onAgent(agentCall({ subagent_type: type }))).stdout).toBe("");
    }
    expect(requests).toHaveLength(0);
  });
});

describe("runtimes and install modes", () => {
  test("routes the same under Node as under Bun", async () => {
    await enable();
    mode.effort = effortAnswers(2.1, { verification_central: 0.9 });
    const result = await onPrompt(
      { session_id: SESSION, prompt: "fix the flaky crash", transcript_path: transcriptAt("medium") },
      { JEV_ROUTER_RUNTIME: "node" },
    );
    expect(result.json.systemMessage).toStartWith("jev → high");
  });

  test("the frontmatter copy of the hooks steps aside inside a plugin install", async () => {
    await enable();
    mode.effort = effortAnswers(2.1, { verification_central: 0.9 });
    const result = await run(["bash", `${SCRIPTS}/run`, "--from-skill", "on-prompt"], { session_id: SESSION, prompt: "fix it" });
    expect(result.stdout).toBe("");
    expect(requests).toHaveLength(0);
  });

  test("a skill install routes to bare skill names", async () => {
    const skills = mkdtempSync(join(tmpdir(), "jev-skills-"));
    cpSync(join(ROOT, "skills", "jev"), join(skills, "jev"), { recursive: true });
    try {
      const skillRun = (input: unknown) => run(["bash", "jev/scripts/run", "--from-skill", "on-prompt"], input, {}, skills);
      await skillRun({ session_id: SESSION, prompt: "/jev" });
      mode.effort = effortAnswers(2.1, { verification_central: 0.9 });
      const result = await skillRun({ session_id: SESSION, prompt_id: "p1", prompt: "fix it", transcript_path: transcriptAt("medium") });
      expect(result.json.hookSpecificOutput.additionalContext).toContain("Skill(jev-high)");
      const denied = await run(["bash", "jev/scripts/run", "--from-skill", "gate"], { session_id: SESSION, prompt_id: "p1", tool_name: "Bash", tool_input: {} }, {}, skills);
      expect(denied.json.hookSpecificOutput.permissionDecisionReason).toContain("Skill(jev-high)");
    } finally {
      rmSync(skills, { recursive: true, force: true });
    }
  });
});

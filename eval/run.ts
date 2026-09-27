// Calibration harness. Live mode calls Jev once per fixture and saves the raw answers to
// eval/results/latest.json; --replay re-runs only the policy on those saved answers, so
// thresholds in skills/jev/scripts/lib/policy.ts can be tuned without API calls.
//
//   bun eval/run.ts            live run over eval/fixtures.jsonl (+ fixtures.local.jsonl if present)
//   bun eval/run.ts --replay   policy only, on the last live run's answers

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { askJev, type Answer } from "../skills/jev/scripts/lib/jev.ts";
import { loadConfig } from "../skills/jev/scripts/lib/config.ts";
import { decideEffort, decideSubagentModel, LEVELS, readEffortAnswers, type Level } from "../skills/jev/scripts/lib/policy.ts";
import { shapePrompt, truncate } from "../skills/jev/scripts/lib/prompt.ts";
import { effortQuestions, subagentQuestions, type EffortState } from "../skills/jev/scripts/lib/questions.ts";

type Fixture =
  | {
      kind: "effort";
      source: string;
      prompt: string;
      previous?: string;
      previousLevel?: Level;
      expected: Level;
      accept: Level[];
    }
  | { kind: "subagent"; source: string; prompt: string; description?: string; expected: string };

type Saved = { answers: Record<string, Answer> | null; latencyMs: number | null; jevModel: string | null };

const DIR = import.meta.dir;
const RESULTS = join(DIR, "results", "latest.json");
const CONCURRENCY = 6;
const TARGETS = { acceptable: 0.9, withinOne: 0.95, exact: 0.6, p95Ms: 800, subagent: 0.8 };

const fixtures: Fixture[] = ["fixtures.jsonl", "fixtures.local.jsonl"]
  .map((name) => join(DIR, name))
  .filter(existsSync)
  .flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Fixture),
  );

const replay = process.argv.includes("--replay");
const saved: Saved[] = replay ? loadSaved() : await runLive();

report();

function loadSaved(): Saved[] {
  const results = JSON.parse(readFileSync(RESULTS, "utf8")) as { prompt: string; saved: Saved }[];
  const byPrompt = new Map(results.map((r) => [r.prompt, r.saved]));
  return fixtures.map((f) => byPrompt.get(f.prompt) ?? { answers: null, latencyMs: null, jevModel: null });
}

async function runLive(): Promise<Saved[]> {
  const apiKey = loadConfig().apiKey;
  if (!apiKey) throw new Error("Set TYPESAFE_API_KEY or JEV_API_KEY to run the live eval.");
  const out: Saved[] = new Array(fixtures.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < fixtures.length) {
        const i = next++;
        const fixture = fixtures[i]!;
        const [state, questions] =
          fixture.kind === "effort" ? effortRequest(fixture) : subagentRequest(fixture);
        const result = await askJev(state, questions, { apiKey, timeoutMs: 10_000 });
        out[i] = {
          answers: result?.answers ?? null,
          latencyMs: result?.latencyMs ?? null,
          jevModel: result?.model ?? null,
        };
      }
    }),
  );
  mkdirSync(join(DIR, "results"), { recursive: true });
  writeFileSync(RESULTS, JSON.stringify(fixtures.map((f, i) => ({ prompt: f.prompt, saved: out[i] })), null, 2));
  return out;
}

function effortRequest(fixture: Extract<Fixture, { kind: "effort" }>) {
  const shaped = shapePrompt(fixture.prompt);
  const state: EffortState = { current_request: shaped.skip ? fixture.prompt : shaped.text };
  if (fixture.previous) state.previous_request = fixture.previous;
  return [state, effortQuestions()] as const;
}

function subagentRequest(fixture: Extract<Fixture, { kind: "subagent" }>) {
  const state: Record<string, string> = { subagent_task: truncate(fixture.prompt) };
  if (fixture.description) state.description = fixture.description;
  return [state, subagentQuestions()] as const;
}

function report(): void {
  const matrix = new Map<string, number>();
  const rules = new Map<string, number>();
  const misses: string[] = [];
  let effortTotal = 0;
  let exact = 0;
  let acceptable = 0;
  let withinOne = 0;
  let abstained = 0;
  let failed = 0;
  let subagentTotal = 0;
  let subagentCorrect = 0;
  const latencies: number[] = [];

  fixtures.forEach((fixture, i) => {
    const result = saved[i]!;
    if (result.latencyMs !== null) latencies.push(result.latencyMs);
    if (!result.answers) {
      failed++;
      misses.push(`  [no answer] ${fixture.prompt.slice(0, 90)}`);
      return;
    }

    if (fixture.kind === "subagent") {
      subagentTotal++;
      const answer = result.answers.work;
      const picked = answer?.type === "choice" ? answer.choice : "?";
      const routed = decideSubagentModel(answer, undefined, { judgment: "judgment", delegated: "delegated" }).model ?? `(${picked}, low conf)`;
      if (picked === fixture.expected) subagentCorrect++;
      else {
        const probs = answer?.type === "choice" ? JSON.stringify(answer.probabilities) : "";
        misses.push(`  [subagent] want ${fixture.expected}, got ${routed} ${probs} · ${fixture.prompt.slice(0, 80)}`);
      }
      return;
    }

    effortTotal++;
    const answers = readEffortAnswers(result.answers);
    if (!answers) {
      failed++;
      return;
    }
    const decision = decideEffort(answers, { previousLevel: fixture.previousLevel ?? null });
    for (const rule of decision.rules) rules.set(rule, (rules.get(rule) ?? 0) + 1);
    const got = decision.level;
    matrix.set(`${fixture.expected}>${got ?? "none"}`, (matrix.get(`${fixture.expected}>${got ?? "none"}`) ?? 0) + 1);
    if (got === null) abstained++;
    if (got === fixture.expected) exact++;
    if (got !== null && fixture.accept.includes(got)) acceptable++;
    if (got !== null && Math.abs(LEVELS.indexOf(got) - LEVELS.indexOf(fixture.expected)) <= 1) withinOne++;
    if (got === null || !fixture.accept.includes(got)) {
      const signals = Object.entries(answers.signals)
        .filter(([, v]) => v >= 0.5)
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(" ");
      misses.push(
        `  [${fixture.source}] want ${fixture.expected} (ok: ${fixture.accept.join("/")}), got ${got ?? "none"} · score ${answers.score.toFixed(2)} conf ${answers.confidence.toFixed(2)} rules ${decision.rules.join(",") || "-"} ${signals}\n      ${fixture.prompt.slice(0, 110)}`,
      );
    }
  });

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "n/a");
  const cols = [...LEVELS, "none"];
  console.log(`\nEffort: ${effortTotal} prompts${replay ? " (replay)" : ""}`);
  console.log(`  expected \\ got  ${cols.map((c) => c.padStart(6)).join("")}`);
  for (const row of LEVELS) {
    const cells = cols.map((c) => String(matrix.get(`${row}>${c}`) ?? "·").padStart(6));
    console.log(`  ${row.padEnd(15)}${cells.join("")}`);
  }
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const lines = [
    ["acceptable", acceptable / effortTotal, TARGETS.acceptable],
    ["within one level", withinOne / effortTotal, TARGETS.withinOne],
    ["exact", exact / effortTotal, TARGETS.exact],
  ] as const;
  for (const [name, value, target] of lines) {
    console.log(`  ${name.padEnd(17)} ${pct(value * effortTotal, effortTotal).padStart(4)}  target ${pct(target * 100, 100)} ${value >= target ? "✓" : "✗"}`);
  }
  console.log(`  abstained ${abstained} · failed ${failed} · rules ${[...rules].map(([k, v]) => `${k}=${v}`).join(" ") || "-"}`);
  console.log(`\nSubagent model: ${pct(subagentCorrect, subagentTotal)} of ${subagentTotal}  target ${pct(TARGETS.subagent * 100, 100)} ${subagentCorrect / subagentTotal >= TARGETS.subagent ? "✓" : "✗"}`);
  if (!replay) {
    console.log(`\nLatency p50 ${p50}ms · p95 ${p95}ms  target p95 < ${TARGETS.p95Ms}ms ${p95 < TARGETS.p95Ms ? "✓" : "✗"}`);
  }
  if (misses.length) console.log(`\nMisses:\n${misses.join("\n")}`);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

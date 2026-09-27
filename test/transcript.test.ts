import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionEffort } from "../skills/jev/scripts/lib/transcript.ts";

const dir = mkdtempSync(join(tmpdir(), "jev-transcript-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function transcript(name: string, entries: object[]): string {
  const path = join(dir, name);
  writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
  return path;
}

test("returns the latest unattributed main-chain effort", () => {
  const path = transcript("a.jsonl", [
    { type: "assistant", effort: "medium", attributionSkill: null },
    { type: "user" },
    { type: "assistant", effort: "high", attributionSkill: null },
    { type: "assistant", effort: "low", attributionSkill: "jev:jev-low" },
    { type: "assistant", effort: "low", isSidechain: true },
  ]);
  expect(sessionEffort(path)).toBe("high");
});

test("returns null with no usable entry or file", () => {
  expect(sessionEffort(transcript("b.jsonl", [{ type: "user" }]))).toBeNull();
  expect(sessionEffort(join(dir, "missing.jsonl"))).toBeNull();
  expect(sessionEffort(undefined)).toBeNull();
});

test("skips torn lines", () => {
  const path = join(dir, "c.jsonl");
  writeFileSync(path, `${JSON.stringify({ type: "assistant", effort: "xhigh" })}\n{"type":"assistant","eff`);
  expect(sessionEffort(path)).toBe("xhigh");
});

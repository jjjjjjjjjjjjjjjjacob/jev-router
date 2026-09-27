import { describe, expect, test } from "bun:test";
import { shapePrompt, truncate } from "../skills/jev/scripts/lib/prompt.ts";

describe("shapePrompt", () => {
  test("skips empty and slash-command prompts", () => {
    expect(shapePrompt("   ")).toEqual({ skip: true, reason: "empty" });
    expect(shapePrompt(undefined)).toEqual({ skip: true, reason: "empty" });
    expect(shapePrompt("/jev off")).toEqual({ skip: true, reason: "slash-command" });
  });

  test("replaces pasted blocks with a size marker", () => {
    const raw = 'fix this\n<pasted_content id="a1">\nsecret=hunter2\nline two\n</pasted_content id="a1">\nplease';
    const shaped = shapePrompt(raw);
    expect(shaped).toEqual({ skip: false, text: "fix this\n[pasted text: 23 chars]\nplease" });
  });

  test("a prompt that is only a paste keeps just the marker", () => {
    expect(shapePrompt('<pasted_content id="x">\nabc\n</pasted_content id="x">')).toEqual({
      skip: false,
      text: "[pasted text: 3 chars]",
    });
  });

  test("keeps head and tail of a long prompt", () => {
    const long = `${"a".repeat(3500)}${"z".repeat(1500)}`;
    const shaped = shapePrompt(long);
    if (shaped.skip) throw new Error("unexpected skip");
    expect(shaped.text.startsWith("a".repeat(3000))).toBe(true);
    expect(shaped.text.endsWith("z".repeat(1000))).toBe(true);
    expect(shaped.text).toContain("[... 1000 chars omitted ...]");
  });
});

test("truncate leaves short text alone", () => {
  expect(truncate("short")).toBe("short");
});

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../skills/jev/scripts/lib/config.ts";
import { parseJevCommand } from "../skills/jev/scripts/lib/command.ts";

const dir = mkdtempSync(join(tmpdir(), "jev-config-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("defaults suit any account", () => {
  expect(loadConfig({ JEV_ROUTER_DATA: dir })).toEqual({
    apiKey: null,
    judgmentModel: "opus",
    delegatedModel: "sonnet",
    routeSubagents: true,
  });
});

test("plugin options beat env vars, which beat the config file", () => {
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ apiKey: "file-key", judgmentModel: "file-j", delegatedModel: "file-d", routeSubagents: false }),
  );
  expect(loadConfig({ JEV_ROUTER_DATA: dir })).toEqual({
    apiKey: "file-key",
    judgmentModel: "file-j",
    delegatedModel: "file-d",
    routeSubagents: false,
  });
  expect(
    loadConfig({ JEV_ROUTER_DATA: dir, JEV_API_KEY: "env-key", JEV_JUDGMENT_MODEL: "fable", JEV_ROUTE_SUBAGENTS: "on" }),
  ).toMatchObject({ apiKey: "env-key", judgmentModel: "fable", routeSubagents: true });
  expect(
    loadConfig({
      JEV_ROUTER_DATA: dir,
      TYPESAFE_API_KEY: "env-key",
      CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY: "plugin-key",
      CLAUDE_PLUGIN_OPTION_DELEGATED_MODEL: "opus",
      CLAUDE_PLUGIN_OPTION_ROUTE_SUBAGENTS: "true",
    }),
  ).toMatchObject({ apiKey: "plugin-key", delegatedModel: "opus", routeSubagents: true });
});

test("blank values fall through", () => {
  expect(loadConfig({ JEV_ROUTER_DATA: join(dir, "none"), CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY: " ", JEV_API_KEY: "k" }).apiKey).toBe("k");
});

test("parses /jev in both install modes", () => {
  expect(parseJevCommand("/jev")).toBe("on");
  expect(parseJevCommand("/jev off\n")).toBe("off");
  expect(parseJevCommand("/jev:jev status")).toBe("status");
  expect(parseJevCommand("/jevx")).toBeNull();
  expect(parseJevCommand("please /jev")).toBeNull();
});

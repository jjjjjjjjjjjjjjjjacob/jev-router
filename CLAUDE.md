# jev-router development

This repo is the Claude Code plugin `jev` (marketplace `jev-router`). Its six skills also install on their own with `npx skills add`. Read `README.md` for the mechanism, and `.agents/docs/jev-router-learnings.mdc` before changing hooks, skills, questions, or policy.

## Layout

- `skills/jev/scripts/` holds the whole runtime, so a skill install is self-contained:
  - `run`: the launcher
  - `on-prompt.ts` and `on-agent.ts`: the hook entry points
  - `gate.sh`: the per-tool-call gate
  - `lib/`: shared code
- `hooks/hooks.json` wires those scripts up for plugin installs.
- The `skills/jev/SKILL.md` frontmatter wires the same scripts up for skill installs. Those hooks pass `--from-skill`, and `run` makes them exit inside a plugin install so nothing runs twice.
- `skills/jev-<level>/` are the tier skills that set per-turn effort.

## Version synchronization rule

When bumping the version, update all of these together:

1. `.claude-plugin/plugin.json`: `"version"`
2. `.claude-plugin/marketplace.json`: `"version"`, which appears twice (root and the plugins array)
3. `package.json`: `"version"`

## Rules

- **Fail open.** Hooks exit 0 with no output on any error. Keep `gate.sh` pure bash, because it runs on every tool call.
- **Runtime code must run on Bun and on Node 22.18+.**
  - Use no Bun-only APIs outside `test/` and `eval/`.
  - Write relative imports with an explicit `.ts` extension.
  - Import types with `import type`.
- **Rerun the eval after changing the questions.** Changes to `lib/questions.ts` need a live `bun run eval`. Threshold-only changes to `lib/policy.ts` can use `bun eval/run.ts --replay`. Record the new numbers in `README.md`.
- **Never commit `eval/fixtures.local.jsonl` or `eval/results/`.** They hold real prompts.
- **Before handing off,** run `bun test`, `bun run typecheck`, and `claude plugin validate .claude-plugin/plugin.json`.

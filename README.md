# jev-router

**jev-router picks the effort level for every prompt in Claude Code, and the right model for every subagent.** It uses [TypeSafe](https://typesafe.ai)'s Jev model, a fast classifier that answers in about 200 ms. It's off until you type `/jev`, and it only affects that session.

```
> fix the flaky crash in the compaction path, reproduce it first
  jev → high · verification, edge cases (conf 0.72)

> rename getUser to fetchUser everywhere
  jev → low · quick, in the loop (conf 1.00)
```

It builds on Thariq's [Using Claude Code: Spending your effort](https://x.com/trq212/status/2103576349499855160). Effort mostly buys verification and edge-case testing:

- **low**: quick, in-the-loop work
- **medium**: regular feature work
- **high**: verification or brownfield bugs
- **xhigh**: edge-case-dense work
- **max**: fully autonomous, mission-critical work

Picking the right level every turn gets you speed where it's cheap and rigor where it pays.

## Quick start

You need three things:

- **Claude Code.** Built and tested on 2.1.280.
- **[Bun](https://bun.sh) or Node.js 22.18+** on your `PATH`.
- **A TypeSafe API key** from [console.typesafe.ai/keys](https://console.typesafe.ai/keys).

Install it one of two ways, not both, since each one defines `/jev`.

### Option A: plugin (recommended)

In Claude Code:

```
/plugin marketplace add jjjjjjjjjjjjjjjjacob/jev-router
/plugin install jev@jev-router
/plugin configure jev@jev-router      # paste your TypeSafe key; it's stored in your keychain
```

Or from a shell:

```bash
claude plugin marketplace add jjjjjjjjjjjjjjjjacob/jev-router
claude plugin install jev@jev-router
```

If you skip `/plugin configure`, set the key with `export TYPESAFE_API_KEY=...` before launching Claude Code instead. Then start a new session and type `/jev`.

### Option B: skills only

```bash
npx skills add jjjjjjjjjjjjjjjjacob/jev-router -g -a claude-code -s '*' -y
```

To install without npm, clone the repo and copy the six skill folders:

```bash
git clone --depth 1 https://github.com/jjjjjjjjjjjjjjjjacob/jev-router /tmp/jev-router
mkdir -p ~/.claude/skills && cp -R /tmp/jev-router/skills/* ~/.claude/skills/
```

Then give it your key, either with `export TYPESAFE_API_KEY=...` or with a config file, which also works for sessions launched from a GUI:

```bash
mkdir -p ~/.claude/jev-router
printf '{ "apiKey": "YOUR_TYPESAFE_KEY" }\n' > ~/.claude/jev-router/config.json
chmod 600 ~/.claude/jev-router/config.json
```

Type `/jev` in a session. Skill installs have one difference from the plugin: the hooks are registered when you type `/jev`, so run it again after resuming a session.

## Usage

```
/jev          turn routing on for this session
/jev status   show this session's recent decisions
/jev off      turn it off
```

While routing is on:

- **Effort:** each prompt shows `jev → <level> · <why>`. The rest of that turn runs at that level, and your next prompt starts back at the session's level.
- **Subagents:** when an Agent call's model is changed, you see `jev → subagent on <model> (<why>)`.

## Configuration

| Setting | Plugin option (`/plugin configure`) | Environment variable | `~/.claude/jev-router/config.json` | Default |
|---|---|---|---|---|
| TypeSafe API key | `typesafe_api_key` | `TYPESAFE_API_KEY` or `JEV_API_KEY` | `apiKey` | none |
| Model for judgment subagents | `judgment_model` | `JEV_JUDGMENT_MODEL` | `judgmentModel` | `opus` |
| Model for delegated subagents | `delegated_model` | `JEV_DELEGATED_MODEL` | `delegatedModel` | `sonnet` |
| Route subagent models at all | `route_subagents` | `JEV_ROUTE_SUBAGENTS` | `routeSubagents` | `true` |

- **Precedence:** plugin option, then environment variable, then config file.
- **Model values** are the aliases the Agent tool accepts: `opus`, `sonnet`, `haiku`, `fable`. For example, set `fable` for judgment and `opus` for delegated if you'd rather spend more on review and design.

## How it works

No hook can set Claude Code's effort directly. A skill's `effort:` frontmatter can, though: it applies for the rest of the turn in which Claude loads it. So jev-router works in three steps.

1. **Ask Jev.** A `UserPromptSubmit` hook sends your prompt, plus the previous routed prompt, to Jev in one request with six questions:
   - an effort Score over five concrete levels
   - five yes/no signals: is this a continuation, a quick pass, a request to work autonomously, full of hidden edge cases, or verification-heavy?
2. **Pick a level.** A small policy in `skills/jev/scripts/lib/policy.ts` turns the answers into a level:
   - A bare "yes, go ahead" keeps the previous level.
   - Strong edge-case or verification signals raise the level to at least `high`, but only when the Score is unsure.
   - An explicit request for a quick pass caps the level at `medium`.
   - A Score with low confidence and no other signal leaves effort alone.
3. **Apply it.** If the level differs from the session's current level, Claude is told to load `jev-<level>`, a tiny skill whose frontmatter sets that effort.
   - A gate hook blocks the first other tool call until the skill has loaded.
   - It blocks at most once per turn, so a turn can't get stuck.

**Subagents.** A `PreToolUse(Agent)` hook asks Jev whether a subagent's task is delegated work or judgment:

- Delegated work (implementation, research, search, mechanical edits) goes to `delegated_model`.
- Judgment (review, verification, design, root-cause debugging, user-facing copy, redoing failed work) goes to `judgment_model`.

The hook rewrites `model` when Jev's confidence is at least 0.6. A model outside your two configured tiers is always replaced. `Explore`, `fork`, and the built-in lookup agents are left alone. Subagents also inherit the turn's routed effort.

**Failures pass through.** Every hook fails open: a timeout (2.5s), an API error, a missing key, a missing runtime, or bad input lets the prompt through untouched.

**Prompt cache.** On Opus 5.5 and Fable 5.1, with an API key or a Claude subscription, changing effort keeps the prompt cache, so routing every turn is free. On other models, and on Bedrock, Vertex, or Foundry, each effort change re-reads the conversation, which costs tokens.

## What leaves your machine

While `/jev` is on, each prompt is sent to `api.typesafe.ai`, together with the first 1,500 characters of the previous routed prompt.

- Pasted blocks are replaced with `[pasted text: N chars]`.
- Prompts over 4,000 characters keep only their first 3,000 and last 1,000.
- Slash commands aren't sent.
- For subagents, the Agent call's `prompt` and `description` are sent.

While routing is off, nothing is sent. Decisions are logged locally to `~/.claude/jev-router/decisions.jsonl`. Each entry holds a hash of the prompt, its first 80 characters, the answers, and the chosen level.

## Accuracy

Results from `bun run eval` against `jev-1.13.0`, on 58 effort prompts and 12 subagent prompts. The effort prompts are 30 in `eval/fixtures.jsonl` plus 28 private prompts from real sessions.

| | Result | Target |
|---|---|---|
| Acceptable level | 97% | 90% |
| Within one level | 97% | 95% |
| Exact level | 83% | 60% |
| Subagent work type | 100% | 80% |
| Jev latency p50 / p95 | 201 / 347 ms | p95 under 800 ms |

The only misses are deliberately underspecified builds ("build a fitness app"). On those, Jev isn't confident and the router leaves effort alone.

## Limits

- **Text-only turns may run at the session level.** The gate enforces the skill only on tool calls, so a turn where Claude answers without tools can skip it.
- **Routed turns override your `/effort` setting.** An explicit `/effort` still sets the session level. Use `/jev off` to take manual control.
- **The main-loop model is never changed.** Switching models mid-session re-reads the whole context.
- **Jev reads literally.** Wording in `skills/jev/scripts/lib/questions.ts` matters more than thresholds, so rerun the eval after any change.

## Development

```bash
bun install
bun test                  # policy, prompt shaping, config, transcript reading, hook contracts (Bun and Node)
bun run typecheck
bun run eval              # live calibration against Jev (needs a key); saves answers to eval/results/
bun eval/run.ts --replay  # re-run only the policy on saved answers, with no API calls
claude --plugin-dir .     # try the plugin without installing it
```

The whole runtime lives in `skills/jev/scripts/`, so a skill install is self-contained.

- **Plugin install:** `hooks/hooks.json` runs those scripts in every session, and they exit immediately unless `/jev` is on.
- **Skill install:** the same hooks are declared in `skills/jev/SKILL.md` frontmatter and registered when you type `/jev`.

Put private prompts for the eval in `eval/fixtures.local.jsonl`, which is gitignored.

## License

MIT

---
name: jev
description: Turn Jev effort routing on or off for this session, or show its status. Jev picks an effort level for each prompt and a model for each subagent.
argument-hint: "[on|off|status]"
disable-model-invocation: true
# These hooks serve skill installs (npx skills add, or a copy in ~/.claude/skills): typing
# /jev registers them for the session. In a plugin install, hooks/hooks.json runs the same
# scripts and the --from-skill copies below exit immediately.
hooks:
  UserPromptSubmit:
    - hooks:
        - type: command
          command: 'd="${CLAUDE_SKILL_DIR:-$CLAUDE_PLUGIN_ROOT}"; [ -f "$d/scripts/run" ] && exec bash "$d/scripts/run" --from-skill on-prompt; exit 0'
          timeout: 8
  PreToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: 'd="${CLAUDE_SKILL_DIR:-$CLAUDE_PLUGIN_ROOT}"; [ -f "$d/scripts/run" ] && exec bash "$d/scripts/run" --from-skill on-agent; exit 0'
          timeout: 8
    - matcher: "*"
      hooks:
        - type: command
          command: 'd="${CLAUDE_SKILL_DIR:-$CLAUDE_PLUGIN_ROOT}"; [ -f "$d/scripts/run" ] && exec bash "$d/scripts/run" --from-skill gate; exit 0'
          timeout: 5
---
The jev-router hook already applied `/jev $ARGUMENTS` and put the result in a jev-router system reminder. Relay that result to the user in one or two short lines, keeping any listed decisions as written. Do nothing else.

If there is no jev-router reminder, tell the user the router's hook didn't run. It needs Bun or Node 22.18+ on the PATH, and in a skill install it has to be enabled with /jev again after a session is resumed.

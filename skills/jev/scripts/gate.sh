#!/bin/bash
# PreToolUse(*): on a routed turn, make sure the jev-<level> skill loads before any other
# tool runs. Runs on every tool call, so it's pure bash (no jq) and the common path is a
# regex and a file test. Fails open: denies at most once per turn, then drops its marker so
# a turn can't deadlock.
set -u
input=$(cat)
data="${JEV_ROUTER_DATA:-$HOME/.claude/jev-router}"

field() { # first top-level-looking "key":"value" string in the hook input
  [[ $input =~ \"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]] && printf '%s' "${BASH_REMATCH[1]}"
}

session="$(field session_id)"
[[ $session =~ ^[A-Za-z0-9_-]+$ ]] || exit 0
pending="$data/sessions/$session.pending"
[ -f "$pending" ] || exit 0
# Tool calls inside a subagent aren't the main turn; leave them alone.
[[ $input =~ \"agent_id\"[[:space:]]*: ]] && exit 0

read -r level marker_prompt < "$pending" || { rm -f "$pending"; exit 0; }
case "$level" in low | medium | high | xhigh | max) ;; *) rm -f "$pending"; exit 0 ;; esac

# A marker from another prompt is stale.
prompt_id="$(field prompt_id)"
if [ -n "$prompt_id" ] && [ "${marker_prompt:--}" != "-" ] && [ "$marker_prompt" != "$prompt_id" ]; then
  rm -f "$pending"
  exit 0
fi

if [ "$(field tool_name)" = "Skill" ]; then
  case "$(field skill)" in
    jev-"$level" | *:jev-"$level") rm -f "$pending" ;;
  esac
  exit 0
fi

rm -f "$pending"
skill="jev-$level"
[ -f "$(dirname "${BASH_SOURCE[0]}")/../../../.claude-plugin/plugin.json" ] && skill="jev:jev-$level"
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"jev-router: invoke Skill(%s) first. It sets effort to %s for this turn. Then retry this call."}}\n' "$skill" "$level"
exit 0

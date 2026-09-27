// UserPromptSubmit hooks get no effort field and no $CLAUDE_EFFORT, so the session's
// current level is read off the transcript. Entries written while a skill is active carry
// `attributionSkill` and that skill's per-turn effort, so only unattributed main-chain
// entries reflect the session level.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isLevel, type Level } from "./policy.ts";

const TAIL_BYTES = 512 * 1024;

export function sessionEffort(transcriptPath: string | undefined): Level | null {
  if (!transcriptPath) return null;
  let fd: number | null = null;
  try {
    fd = openSync(transcriptPath, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // first line may be cut mid-record

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !line.includes('"assistant"')) continue;
      try {
        const entry = JSON.parse(line) as {
          type?: string;
          isSidechain?: boolean;
          attributionSkill?: string | null;
          effort?: unknown;
        };
        if (entry.type !== "assistant" || entry.isSidechain || entry.attributionSkill) continue;
        if (isLevel(entry.effort)) return entry.effort;
      } catch {
        // skip a torn line
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

// Hook plumbing shared by the entry points. Runs on Bun or Node 22.18+. Every hook fails
// open: any error exits 0 with no output, as if the router weren't installed.

import { createHash } from "node:crypto";

export type HookInput = {
  session_id?: string;
  prompt_id?: string;
  transcript_path?: string;
  prompt?: string;
  permission_mode?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  agent_id?: string;
  [key: string]: unknown;
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function readHookInput(): Promise<HookInput | null> {
  try {
    const parsed = JSON.parse(await readStdin());
    return parsed && typeof parsed === "object" ? (parsed as HookInput) : null;
  } catch {
    return null;
  }
}

// Resolves once the write is flushed; stdout pipes are asynchronous on macOS, so exiting
// right after an unflushed write can drop the hook's output.
export function emit(output: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify(output)}\n`, () => resolve());
  });
}

export async function runHook(handler: (input: HookInput) => Promise<void>): Promise<void> {
  try {
    const input = await readHookInput();
    if (input) await handler(input);
  } catch {
    // fail open
  }
  process.exit(0);
}

export function preview(text: string, length = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

export function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

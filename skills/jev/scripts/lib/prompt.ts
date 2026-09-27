// Shapes a user prompt before it leaves the machine for api.typesafe.ai: pasted blocks
// become a size marker, long prompts keep only their head and tail.

const PASTED_BLOCK = /<pasted_content id="([^"]*)">\n?([\s\S]*?)\n?<\/pasted_content id="\1">/g;

export const HEAD_CHARS = 3000;
export const TAIL_CHARS = 1000;

export type ShapedPrompt =
  | { skip: false; text: string }
  | { skip: true; reason: "empty" | "slash-command" };

export function shapePrompt(raw: string | undefined | null): ShapedPrompt {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { skip: true, reason: "empty" };
  // Slash commands and skills carry their own effort; /jev itself is handled on expansion.
  if (trimmed.startsWith("/")) return { skip: true, reason: "slash-command" };

  const withoutPastes = trimmed
    .replace(PASTED_BLOCK, (_match, _id, body: string) => `[pasted text: ${body.length} chars]`)
    .trim();
  if (!withoutPastes) return { skip: true, reason: "empty" };

  return { skip: false, text: truncate(withoutPastes) };
}

export function truncate(text: string, head = HEAD_CHARS, tail = TAIL_CHARS): string {
  if (text.length <= head + tail) return text;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n[... ${omitted} chars omitted ...]\n${text.slice(-tail)}`;
}

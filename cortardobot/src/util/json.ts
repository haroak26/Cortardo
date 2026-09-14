export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty model response");

  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());
  candidates.push(trimmed);

  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const start =
    firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
  if (start >= 0) {
    const balanced = sliceBalanced(trimmed, start);
    if (balanced) candidates.push(balanced);
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  throw new Error(`could not parse JSON from model response: ${trimmed.slice(0, 200)}`);
}

function sliceBalanced(input: string, start: number): string | null {
  const open = input[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i++) {
    const char = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return extractJson(text) as T;
  } catch {
    return fallback;
  }
}

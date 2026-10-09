export type MathSegment = {
  type: "text" | "math";
  value: string;
  display: boolean;
};

const DELIMITERS = [
  { open: "$$", close: "$$", display: true },
  { open: "\\[", close: "\\]", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "$", close: "$", display: false }
] as const;

export function tokenizeMath(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let textStart = 0;
  let cursor = 0;

  while (cursor < text.length) {
    const delimiter = DELIMITERS.find(({ open }) => text.startsWith(open, cursor));
    if (!delimiter || isEscaped(text, cursor)) {
      cursor += 1;
      continue;
    }

    const contentStart = cursor + delimiter.open.length;
    const contentEnd = findClosingDelimiter(text, delimiter.close, contentStart);
    if (contentEnd < 0) {
      cursor += delimiter.open.length;
      continue;
    }

    if (cursor > textStart) {
      segments.push({ type: "text", value: text.slice(textStart, cursor), display: false });
    }
    segments.push({
      type: "math",
      value: text.slice(contentStart, contentEnd),
      display: delimiter.display
    });

    cursor = contentEnd + delimiter.close.length;
    textStart = cursor;
  }

  if (textStart < text.length || segments.length === 0) {
    segments.push({ type: "text", value: text.slice(textStart), display: false });
  }
  return segments;
}

function findClosingDelimiter(text: string, delimiter: string, start: number): number {
  let cursor = start;
  while (cursor < text.length) {
    const match = text.indexOf(delimiter, cursor);
    if (match < 0) return -1;
    if (!isEscaped(text, match)) return match;
    cursor = match + delimiter.length;
  }
  return -1;
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

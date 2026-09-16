import React from "react";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────────────────
   DOT MATRIX — 5×7 dot-matrix numerals for stat values
   Off dots render in the surface grey, the dots that form the number in
   the success green. Unsupported characters fall back to plain text (see
   dotMatrixText), so this degrades gracefully for any value.
   ────────────────────────────────────────────────────────────────────────── */

const GLYPH_COLS = 5;
const GLYPH_ROWS = 7;

const GLYPHS: Record<string, readonly string[]> = {
  "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ",": ["00000", "00000", "00000", "00000", "00000", "00100", "01000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
  "%": ["11000", "11001", "00010", "00100", "01000", "10011", "00011"],
  "$": ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "£": ["00110", "01001", "01000", "11100", "01000", "01001", "11111"],
  "€": ["00110", "01001", "10000", "11110", "10000", "01001", "00110"],
  h: ["10000", "10000", "10110", "11001", "10001", "10001", "10001"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
};

const DOT_MATRIX_RE = /^[$£€]?[0-9][0-9,.%+\-h]*$/i;

/** Returns the dot-matrix-safe text for a value, or null if it needs plain text. */
export function dotMatrixText(value: React.ReactNode): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return DOT_MATRIX_RE.test(text) ? text : null;
}

export interface DotMatrixValueProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  value: string | number;
  /** Diameter of each dot in px. */
  dotSize?: number;
  /** Gap between dots in px. */
  dotGap?: number;
}

/** A single dot in the matrix — same size for on and off dots, so the gap
    between every dot (horizontal and vertical) is identical. */
function Dot({ on, dotSize }: { on: boolean; dotSize: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn("rounded-full", on ? "bg-success" : "bg-[hsl(220_14%_94%)] dark:bg-[hsl(220_10%_20%)]")}
      style={{ width: dotSize, height: dotSize }}
    />
  );
}

/** Stat value rendered as a dot matrix: grey background dots with green on dots.
    A full column of background dots separates glyphs, and one extra row and
    column of background dots surround the whole number. Empty edge columns are
    trimmed first, so narrow glyphs like "1" never get a double-wide border.
    Everything lives in one grid so the gap between dots stays uniform. */
export function DotMatrixValue({ value, dotSize = 5, dotGap = 1, className, style, ...props }: DotMatrixValueProps) {
  const text = String(value);
  const chars = [...text];
  const glyphColumns = chars.length * GLYPH_COLS + (chars.length - 1);
  const totalColumns = glyphColumns + 2;
  const rows = GLYPH_ROWS + 2;

  const isOn = (column: number, row: number) => {
    const glyphColumn = column - 1;
    const glyphRow = row - 1;
    if (glyphColumn < 0 || glyphColumn >= glyphColumns || glyphRow < 0 || glyphRow >= GLYPH_ROWS) {
      return false;
    }
    const glyphIndex = Math.floor(glyphColumn / (GLYPH_COLS + 1));
    const columnInGlyph = glyphColumn % (GLYPH_COLS + 1);
    if (columnInGlyph >= GLYPH_COLS) return false;
    const glyph = GLYPHS[chars[glyphIndex].toLowerCase()];
    return glyph ? glyph[glyphRow][columnInGlyph] === "1" : false;
  };

  let firstLit = totalColumns;
  let lastLit = -1;
  for (let column = 0; column < totalColumns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      if (isOn(column, row)) {
        firstLit = Math.min(firstLit, column);
        lastLit = Math.max(lastLit, column);
        break;
      }
    }
  }
  const hasLit = lastLit >= 0;
  const startColumn = hasLit ? Math.max(0, firstLit - 1) : 0;
  const endColumn = hasLit ? Math.min(totalColumns - 1, lastLit + 1) : totalColumns - 1;
  const columns = endColumn - startColumn + 1;

  return (
    <span
      {...props}
      role="img"
      aria-label={text}
      className={cn("inline-flex shrink-0", className)}
      style={style}
    >
      <span
        aria-hidden="true"
        className="grid shrink-0"
        style={{
          gridTemplateColumns: `repeat(${columns}, ${dotSize}px)`,
          gridTemplateRows: `repeat(${rows}, ${dotSize}px)`,
          gap: dotGap,
        }}
      >
        {Array.from({ length: rows * columns }, (_, index) => {
          const row = Math.floor(index / columns);
          const column = startColumn + (index % columns);
          return <Dot key={index} on={isOn(column, row)} dotSize={dotSize} />;
        })}
      </span>
    </span>
  );
}

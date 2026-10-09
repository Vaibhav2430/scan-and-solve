import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tokenizeMath } from "./math.ts";

describe("tokenizeMath", () => {
  it("finds inline and display equations", () => {
    assert.deepEqual(tokenizeMath("Use \\(x^2\\), then \\[x = \\sqrt{4}\\]."), [
      { type: "text", value: "Use ", display: false },
      { type: "math", value: "x^2", display: false },
      { type: "text", value: ", then ", display: false },
      { type: "math", value: "x = \\sqrt{4}", display: true },
      { type: "text", value: ".", display: false }
    ]);
  });

  it("leaves unmatched delimiters as text", () => {
    assert.deepEqual(tokenizeMath("The price is $5."), [
      { type: "text", value: "The price is $5.", display: false }
    ]);
  });
});

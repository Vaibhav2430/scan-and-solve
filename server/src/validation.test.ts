import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFollowUpRequest, parseSolveRequest } from "./validation.ts";

const imageDataUrl = "data:image/png;base64,aGVsbG8=";

describe("request validation", () => {
  it("accepts a supported image data URL", () => {
    assert.deepEqual(parseSolveRequest({ imageDataUrl }), { imageDataUrl });
  });

  it("rejects non-image values", () => {
    assert.throws(() => parseSolveRequest({ imageDataUrl: "https://example.com/image.png" }));
  });

  it("trims follow-up questions", () => {
    assert.equal(parseFollowUpRequest({ imageDataUrl, question: "  Why?  ", conversation: [] }).question, "Why?");
  });
});

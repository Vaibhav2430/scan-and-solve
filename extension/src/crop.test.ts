import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scaleRectToImage } from "./crop.ts";

describe("scaleRectToImage", () => {
  it("scales CSS coordinates for a high-density screenshot", () => {
    assert.deepEqual(
      scaleRectToImage(
        { x: 100, y: 50, width: 300, height: 200 },
        { width: 1000, height: 500 },
        { width: 2000, height: 1000 }
      ),
      { x: 200, y: 100, width: 600, height: 400 }
    );
  });

  it("clamps a selection to the image bounds", () => {
    assert.deepEqual(
      scaleRectToImage(
        { x: 90, y: 90, width: 20, height: 20 },
        { width: 100, height: 100 },
        { width: 100, height: 100 }
      ),
      { x: 90, y: 90, width: 10, height: 10 }
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSolver, GeminiSolver, OpenAISolver } from "./solver.ts";

describe("solver selection", () => {
  it("uses demo mode without an API key", () => {
    assert.equal(createSolver({}).mode, "demo");
  });

  it("uses Gemini mode when a Gemini API key exists", () => {
    const solver = createSolver({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "test-key", GEMINI_MODEL: "test-model" });
    assert.equal(solver.mode, "gemini");
    assert.equal(solver.model, "test-model");
  });

  it("keeps OpenAI available only when explicitly selected", () => {
    const solver = createSolver({ AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-model" });
    assert.equal(solver.mode, "openai");
    assert.equal(solver.model, "test-model");
  });

  it("does not use an OpenAI key unless OpenAI is selected", () => {
    assert.equal(createSolver({ OPENAI_API_KEY: "test-key" }).mode, "demo");
  });
});

describe("GeminiSolver", () => {
  it("sends image data with a schema and parses a structured response", async () => {
    const fetchImplementation: typeof fetch = async (input, init) => {
      assert.match(String(input), /test-model:generateContent$/);
      const body = JSON.parse(String(init?.body));
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "test-key");
      assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/png");
      assert.equal(body.contents[0].parts[1].inlineData.data, "aGVsbG8=");
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.equal(body.generationConfig.responseJsonSchema.type, "object");

      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({
            answer: "4",
            interpretedQuestion: "What is 2 + 2?",
            steps: [{ title: "Add", explanation: "Combine both values.", work: "2 + 2 = 4" }],
            note: null
            }) }]
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const solver = new GeminiSolver({
      apiKey: "test-key",
      model: "test-model",
      fetchImplementation
    });
    const result = await solver.solve({ imageDataUrl: "data:image/png;base64,aGVsbG8=" });
    assert.equal(result.answer, "4");
  });
});

describe("OpenAISolver", () => {
  it("parses a structured solution response", async () => {
    const fetchImplementation: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.equal(body.input[0].content[1].type, "input_image");

      return new Response(JSON.stringify({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify({
              answer: "x = 4",
              interpretedQuestion: "Solve 2x = 8",
              steps: [{ title: "Divide", explanation: "Divide both sides by 2.", work: "x = 4" }],
              note: null
            })
          }]
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const solver = new OpenAISolver({
      apiKey: "test-key",
      model: "test-model",
      reasoningEffort: "medium",
      fetchImplementation
    });

    const result = await solver.solve({ imageDataUrl: "data:image/png;base64,aGVsbG8=" });
    assert.equal(result.answer, "x = 4");
    assert.equal(result.steps[0]?.work, "x = 4");
    assert.equal(result.note, undefined);
  });
});

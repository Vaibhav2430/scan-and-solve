import type {
  FollowUpRequest,
  FollowUpResponse,
  SolutionResponse,
  SolutionStep,
  SolveRequest
} from "../../shared/contracts";
import { isSolutionResponse } from "./validation.ts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_OPENAI_MODEL = "gpt-6-luna";
const DEFAULT_GEMINI_MODEL = "gemini-4-hydrogen";
const VALID_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

export interface Solver {
  readonly mode: "demo" | "gemini" | "openai";
  readonly model?: string;
  solve(request: SolveRequest): Promise<SolutionResponse>;
  followUp(request: FollowUpRequest): Promise<FollowUpResponse>;
}

export function createSolver(environment: NodeJS.ProcessEnv = process.env): Solver {
  const provider = environment.AI_PROVIDER?.trim().toLowerCase();
  const geminiApiKey = environment.GEMINI_API_KEY?.trim();
  if ((provider === "gemini" || (!provider && geminiApiKey)) && isUsableApiKey(geminiApiKey)) {
    return new GeminiSolver({
      apiKey: geminiApiKey,
      model: environment.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL
    });
  }

  const openAiApiKey = environment.OPENAI_API_KEY?.trim();
  if (provider !== "openai" || !isUsableApiKey(openAiApiKey)) return new DemoSolver();

  return new OpenAISolver({
    apiKey: openAiApiKey,
    model: environment.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    reasoningEffort: readReasoningEffort(environment.OPENAI_REASONING_EFFORT)
  });
}

type GeminiSolverOptions = {
  apiKey: string;
  model: string;
  fetchImplementation?: typeof fetch;
  maxRetries?: number;
  retryDelayMs?: number;
};

export class GeminiSolver implements Solver {
  readonly mode = "gemini" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: GeminiSolverOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImplementation = options.fetchImplementation || fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
  }

  async solve(request: SolveRequest): Promise<SolutionResponse> {
    const response = await this.generateContent({
      systemInstruction: { parts: [{ text: SOLVE_INSTRUCTIONS }] },
      contents: [{
        role: "user",
        parts: [
          { text: "Read the selected question in this image and solve it. Return the requested structured JSON." },
          { inlineData: imageDataUrlToInlineData(request.imageDataUrl) }
        ]
      }],
      generationConfig: {
        maxOutputTokens: 65_536,
        responseMimeType: "application/json",
        responseJsonSchema: solutionFormat.schema
      }
    });

    const solution = normalizeSolution(parseGeminiJson(response));
    if (!isSolutionResponse(solution)) {
      throw new SolverError("Gemini returned an answer in an unexpected format. Please scan again.");
    }
    return solution;
  }

  async followUp(request: FollowUpRequest): Promise<FollowUpResponse> {
    const priorConversation = request.conversation.length
      ? request.conversation.map((message) => `${message.role}: ${message.content}`).join("\n")
      : "No earlier follow-up messages.";
    const content = [
      "Original solution shown to the user:",
      JSON.stringify(request.solution),
      "",
      "Previous follow-up conversation:",
      priorConversation,
      "",
      `New follow-up question: ${request.question}`
    ].join("\n");

    const response = await this.generateContent({
      systemInstruction: { parts: [{ text: FOLLOW_UP_INSTRUCTIONS }] },
      contents: [{
        role: "user",
        parts: [
          { text: content },
          { inlineData: imageDataUrlToInlineData(request.imageDataUrl) }
        ]
      }],
      generationConfig: {
        maxOutputTokens: 65_536,
        responseMimeType: "application/json",
        responseJsonSchema: followUpFormat.schema
      }
    });

    const value = parseGeminiJson(response);
    if (!isRecord(value) || typeof value.answer !== "string" || !value.answer.trim()) {
      throw new SolverError("Gemini returned an answer in an unexpected format. Please try again.");
    }
    return { answer: value.answer.trim() };
  }

  private async generateContent(body: unknown): Promise<unknown> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImplementation(`${GEMINI_API_BASE_URL}/${encodeURIComponent(this.model)}:generateContent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000)
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") {
          throw new SolverError("Gemini took too long to respond. Please try again.");
        }
        throw new SolverError("The server could not reach Gemini. Check your connection and try again.");
      }

      const payload = await response.json().catch(() => null) as unknown;
      if (response.ok) return payload;
      if (attempt < this.maxRetries && isTransientGeminiError(response.status, payload)) {
        await delay(this.retryDelayMs * 2 ** attempt);
        continue;
      }
      const providerMessage = readGeminiError(payload, response.status, this.model);
      throw new SolverError(providerMessage || `Gemini returned an error (${response.status}).`);
    }
    throw new SolverError("Gemini is temporarily unavailable. Please try again.");
  }
}

type OpenAISolverOptions = {
  apiKey: string;
  model: string;
  reasoningEffort: string;
  fetchImplementation?: typeof fetch;
};

export class OpenAISolver implements Solver {
  readonly mode = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly reasoningEffort: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: OpenAISolverOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort;
    this.fetchImplementation = options.fetchImplementation || fetch;
  }

  async solve(request: SolveRequest): Promise<SolutionResponse> {
    const response = await this.createResponse({
      model: this.model,
      store: false,
      reasoning: { effort: this.reasoningEffort },
      instructions: SOLVE_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Read the selected question in this image and solve it. Return the requested structured JSON."
            },
            {
              type: "input_image",
              image_url: request.imageDataUrl,
              detail: "high"
            }
          ]
        }
      ],
      text: { format: solutionFormat },
      max_output_tokens: 4_000
    });

    const value = parseJsonOutput(response);
    const solution = normalizeSolution(value);
    if (!isSolutionResponse(solution)) {
      throw new SolverError("The AI returned an answer in an unexpected format. Please try again.");
    }
    return solution;
  }

  async followUp(request: FollowUpRequest): Promise<FollowUpResponse> {
    const priorConversation = request.conversation.length
      ? request.conversation.map((message) => `${message.role}: ${message.content}`).join("\n")
      : "No earlier follow-up messages.";

    const response = await this.createResponse({
      model: this.model,
      store: false,
      reasoning: { effort: this.reasoningEffort },
      instructions: FOLLOW_UP_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Original solution shown to the user:",
                JSON.stringify(request.solution),
                "",
                "Previous follow-up conversation:",
                priorConversation,
                "",
                `New follow-up question: ${request.question}`
              ].join("\n")
            },
            {
              type: "input_image",
              image_url: request.imageDataUrl,
              detail: "high"
            }
          ]
        }
      ],
      text: { format: followUpFormat },
      max_output_tokens: 2_000
    });

    const value = parseJsonOutput(response);
    if (!isRecord(value) || typeof value.answer !== "string" || !value.answer.trim()) {
      throw new SolverError("The AI returned an answer in an unexpected format. Please try again.");
    }
    return { answer: value.answer.trim() };
  }

  private async createResponse(body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000)
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new SolverError("The AI took too long to respond. Please try again.");
      }
      throw new SolverError("The server could not reach the AI service. Check your connection and try again.");
    }

    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const providerMessage = readProviderError(payload, this.model);
      throw new SolverError(providerMessage || `The AI service returned an error (${response.status}).`);
    }
    return payload;
  }
}

class DemoSolver implements Solver {
  readonly mode = "demo" as const;

  async solve(_request: SolveRequest): Promise<SolutionResponse> {
    await delay(700);
    return {
      answer: "Demo mode is connected",
      interpretedQuestion: "Your selected image reached the local server successfully.",
      steps: [
        {
          title: "The question was captured",
          explanation: "The extension cropped the exact region you selected and sent only that crop to the local server."
        },
        {
          title: "The answer panel is working",
          explanation: "This response confirms that the extension, sidebar, and server can communicate."
        },
        {
          title: "Add your API key",
          explanation: "Create server/.env from server/.env.example and add a free-tier Gemini API key to enable real answers."
        }
      ],
      note: "Demo mode does not read or solve the question yet."
    };
  }

  async followUp(request: FollowUpRequest): Promise<FollowUpResponse> {
    await delay(350);
    return {
      answer: `Demo mode received: “${request.question}” Add a Gemini API key to enable real follow-up answers.`
    };
  }
}

export class SolverError extends Error {}

const SOLVE_INSTRUCTIONS = `You are Scan & Solve, a careful tutor. Analyze only the question visible in the supplied image.

Return a concise final answer first, followed by clear instructional steps. Each step must explain what to do and why. Put equations, calculations, code, or other working in the work field. Do not reveal hidden chain-of-thought; provide a concise, useful solution a student can follow.

CRITICAL DISPLAY RULE: The sidebar renders mathematical notation only when you include literal LaTeX delimiters. Put every mathematical value, expression, equation, calculation, and matrix inside \\(...\\) for inline math or \\[...\\] for display math. This applies to every output field, including answer, interpretedQuestion, step titles, explanations, work, and note. Do not return bare forms such as x = 5, 17/12, or x^2. Return \\(x = 5\\), \\(\\frac{17}{12}\\), and \\(x^2\\). Use commands such as \\frac, \\sqrt, and \\begin{bmatrix}. Leave programming code and ordinary prose outside math delimiters.

Transcribe the question into interpretedQuestion. Include all answer choices or important labels when present. If the image is incomplete, unreadable, or does not contain a question, say so in the answer, explain what is missing in one step, and use note to ask the user to scan a clearer or larger area. Never invent missing details. Check calculations before responding.`;

const FOLLOW_UP_INSTRUCTIONS = `You are Scan & Solve, a careful tutor answering a follow-up about a previously solved question. Use the supplied image, original displayed solution, and previous messages. Answer the user's new question directly and clearly. If they refer to a numbered step, use the numbering from the original displayed solution. Keep the response focused and do not reveal hidden chain-of-thought.

CRITICAL DISPLAY RULE: The sidebar renders mathematical notation only when you include literal LaTeX delimiters. Put every mathematical value, expression, equation, calculation, and matrix inside \\(...\\) for inline math or \\[...\\] for display math. Do not return bare forms such as x = 5 or 17/12. Return \\(x = 5\\) and \\(\\frac{17}{12}\\). Leave programming code and ordinary prose outside math delimiters.`;

const solutionFormat = {
  type: "json_schema",
  name: "scan_and_solve_solution",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: {
        type: "string",
        description: "Concise final answer. Enclose every mathematical value or expression in literal \\(...\\) or \\[...\\] LaTeX delimiters."
      },
      interpretedQuestion: {
        type: "string",
        description: "Transcribed question. Enclose every mathematical value or expression in literal \\(...\\) or \\[...\\] LaTeX delimiters."
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: {
              type: "string",
              description: "Step title with mathematical notation enclosed in LaTeX delimiters."
            },
            explanation: {
              type: "string",
              description: "Explanation with every mathematical value or expression enclosed in LaTeX delimiters."
            },
            work: {
              type: ["string", "null"],
              description: "Calculations using literal \\(...\\) or \\[...\\] LaTeX delimiters, or plain programming code."
            }
          },
          required: ["title", "explanation", "work"]
        }
      },
      note: {
        type: ["string", "null"],
        description: "Optional note with mathematical notation enclosed in LaTeX delimiters."
      }
    },
    required: ["answer", "interpretedQuestion", "steps", "note"]
  }
};

const followUpFormat = {
  type: "json_schema",
  name: "scan_and_solve_follow_up",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: {
        type: "string",
        description: "Direct answer with every mathematical value or expression enclosed in literal \\(...\\) or \\[...\\] LaTeX delimiters."
      }
    },
    required: ["answer"]
  }
};

function parseJsonOutput(response: unknown): unknown {
  const text = extractOutputText(response);
  if (!text) throw new SolverError("The AI did not return an answer. Please try again.");
  try {
    return JSON.parse(text);
  } catch {
    throw new SolverError("The AI returned an answer that could not be read. Please try again.");
  }
}

function parseGeminiJson(response: unknown): unknown {
  const text = extractGeminiText(response);
  if (!text) throw new SolverError("Gemini did not return an answer. Please try again.");
  try {
    return JSON.parse(text);
  } catch {
    throw new SolverError("Gemini returned an answer that could not be read. Please try again.");
  }
}

function imageDataUrlToInlineData(imageDataUrl: string): { mimeType: string; data: string } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(imageDataUrl);
  if (!match) throw new SolverError("The selected image could not be prepared for Gemini.");
  return { mimeType: match[1], data: match[2] };
}

function extractGeminiText(response: unknown): string | undefined {
  if (!isRecord(response) || !Array.isArray(response.candidates)) return undefined;
  for (const candidate of response.candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) continue;
    for (const part of candidate.content.parts) {
      if (isRecord(part) && typeof part.text === "string") return part.text;
    }
  }
  return undefined;
}

function extractOutputText(response: unknown): string | undefined {
  if (!isRecord(response) || !Array.isArray(response.output)) return undefined;
  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return undefined;
}

function normalizeSolution(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.steps)) return value;
  return {
    ...value,
    note: value.note === null ? undefined : value.note,
    steps: value.steps.map((step): unknown => {
      if (!isRecord(step)) return step;
      const normalized: SolutionStep = {
        title: typeof step.title === "string" ? step.title : "",
        explanation: typeof step.explanation === "string" ? step.explanation : ""
      };
      if (typeof step.work === "string" && step.work.trim()) normalized.work = step.work;
      return normalized;
    })
  };
}

function readProviderError(payload: unknown, model: string): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error) || typeof payload.error.message !== "string") return undefined;
  const message = payload.error.message;
  if (/api key|authentication|incorrect api key/i.test(message)) {
    return "The OpenAI API key is invalid. Check server/.env and restart the server.";
  }
  if (/quota|billing|credit/i.test(message)) {
    return "The OpenAI account has no available API credit. Check API billing and usage limits.";
  }
  if (/model.*(not found|access|permission)/i.test(message)) {
    return `The configured model (${model}) is unavailable for this API account. Update OPENAI_MODEL in server/.env.`;
  }
  return message;
}

function readGeminiError(payload: unknown, status: number, model: string): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error) || typeof payload.error.message !== "string") return undefined;
  const message = payload.error.message;
  if (status === 401 || status === 403 || /api key|permission|authentication/i.test(message)) {
    return "The Gemini API key is invalid or unavailable. Check GEMINI_API_KEY in server/.env and restart the server.";
  }
  if (status === 429 || /quota|rate limit|resource exhausted/i.test(message)) {
    return "The Gemini free-tier limit has been reached. Wait for the quota to reset, then try again.";
  }
  if (/model.*(not found|unavailable|unsupported)/i.test(message)) {
    return `The configured Gemini model (${model}) is unavailable. Update GEMINI_MODEL in server/.env.`;
  }
  return message;
}

function isTransientGeminiError(status: number, payload: unknown): boolean {
  if ([500, 502, 503, 504].includes(status)) return true;
  if (status !== 429 || !isRecord(payload) || !isRecord(payload.error) || typeof payload.error.message !== "string") {
    return false;
  }
  return /high demand|temporar|overload|try again/i.test(payload.error.message);
}

function isUsableApiKey(value: string | undefined): value is string {
  return Boolean(value && value !== "your_api_key_here");
}

function readReasoningEffort(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() || "medium";
  return VALID_REASONING_EFFORTS.has(normalized) ? normalized : "medium";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

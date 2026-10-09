import type {
  ChatMessage,
  FollowUpResponse,
  SolutionResponse
} from "../../../shared/contracts";

const API_BASE_URL = "http://127.0.0.1:8787";

export async function solveImage(
  imageDataUrl: string,
  signal?: AbortSignal
): Promise<SolutionResponse> {
  return post<SolutionResponse>("/api/solve", { imageDataUrl }, signal);
}

export async function askFollowUp(
  imageDataUrl: string,
  question: string,
  conversation: ChatMessage[],
  solution: SolutionResponse,
  signal?: AbortSignal
): Promise<FollowUpResponse> {
  return post<FollowUpResponse>(
    "/api/follow-up",
    { imageDataUrl, question, conversation, solution },
    signal
  );
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("The local server is not running. Start it and try again.");
  }

  const data = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && data.error;
    throw new Error(message || `Request failed (${response.status}).`);
  }

  return data as T;
}

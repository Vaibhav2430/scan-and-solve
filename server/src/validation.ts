import type { ChatMessage, FollowUpRequest, SolveRequest } from "../../shared/contracts";

export const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_LENGTH = 7 * 1024 * 1024;

export function parseSolveRequest(value: unknown): SolveRequest {
  if (!isRecord(value) || !isImageDataUrl(value.imageDataUrl)) {
    throw new Error("A valid JPEG, PNG, or WebP image is required.");
  }
  if (value.imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("The selected image is too large. Select a smaller area.");
  }
  return { imageDataUrl: value.imageDataUrl };
}

export function parseFollowUpRequest(value: unknown): FollowUpRequest {
  if (!isRecord(value) || !isImageDataUrl(value.imageDataUrl)) {
    throw new Error("A valid question image is required.");
  }
  if (typeof value.question !== "string" || !value.question.trim() || value.question.length > 2_000) {
    throw new Error("The follow-up question must be between 1 and 2,000 characters.");
  }
  if (!Array.isArray(value.conversation) || !value.conversation.every(isChatMessage)) {
    throw new Error("The conversation is invalid.");
  }
  return {
    imageDataUrl: value.imageDataUrl,
    question: value.question.trim(),
    conversation: value.conversation.slice(-12)
  };
}

function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(value);
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
    && (value.role === "user" || value.role === "assistant")
    && typeof value.content === "string"
    && value.content.length <= 4_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

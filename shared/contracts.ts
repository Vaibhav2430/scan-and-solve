export type SolutionStep = {
  title: string;
  explanation: string;
  work?: string;
};

export type SolveRequest = {
  imageDataUrl: string;
};

export type FollowUpRequest = {
  imageDataUrl: string;
  question: string;
  conversation: ChatMessage[];
  solution: SolutionResponse;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SolutionResponse = {
  answer: string;
  interpretedQuestion?: string;
  steps: SolutionStep[];
  note?: string;
};

export type FollowUpResponse = {
  answer: string;
};

export type ApiError = {
  error: string;
};

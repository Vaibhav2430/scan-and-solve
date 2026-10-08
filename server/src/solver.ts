import type {
  FollowUpRequest,
  FollowUpResponse,
  SolutionResponse,
  SolveRequest
} from "../../shared/contracts";

export interface Solver {
  solve(request: SolveRequest): Promise<SolutionResponse>;
  followUp(request: FollowUpRequest): Promise<FollowUpResponse>;
}

export function createSolver(): Solver {
  return new DemoSolver();
}

class DemoSolver implements Solver {
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
          title: "Connect a vision model",
          explanation: "The next implementation step is choosing an AI provider and adding its API key to the server."
        }
      ],
      note: "Demo mode does not read or solve the question yet."
    };
  }

  async followUp(request: FollowUpRequest): Promise<FollowUpResponse> {
    await delay(350);
    return {
      answer: `Demo mode received: “${request.question}” Once a vision model is connected, follow-ups will use the selected question and earlier messages.`
    };
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

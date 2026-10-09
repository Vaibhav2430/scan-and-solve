import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessage,
  SolutionResponse
} from "../../../shared/contracts";
import type { ScanErrorState, ScanState } from "../types";
import { askFollowUp, solveImage } from "./api";

type ViewState = "empty" | "solving" | "solved" | "error";

export function App() {
  const [scan, setScan] = useState<ScanState | null>(null);
  const [solution, setSolution] = useState<SolutionResponse | null>(null);
  const [view, setView] = useState<ViewState>("empty");
  const [error, setError] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  const solve = useCallback(async (nextScan: ScanState) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setScan(nextScan);
    setSolution(null);
    setConversation([]);
    setError("");
    setView("solving");

    try {
      const result = await solveImage(nextScan.imageDataUrl, controller.signal);
      setSolution(result);
      setView("solved");
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(readError(requestError));
      setView("error");
    }
  }, []);

  useEffect(() => {
    void chrome.storage.session.get(["currentScan", "scanError"]).then((stored) => {
      const storedScan = stored.currentScan as ScanState | undefined;
      const storedError = stored.scanError as ScanErrorState | undefined;
      if (storedScan) void solve(storedScan);
      else if (storedError) {
        setError(storedError.message);
        setView("error");
      }
    });

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "session") return;
      const nextScan = changes.currentScan?.newValue as ScanState | undefined;
      const nextError = changes.scanError?.newValue as ScanErrorState | undefined;
      if (nextScan) void solve(nextScan);
      if (nextError) {
        setError(nextError.message);
        setView("error");
      }
    };

    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => {
      activeRequest.current?.abort();
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, [solve]);

  async function startScan() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error("No active page was found.");
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["capture.js"] });
    } catch (scanError) {
      setError(readError(scanError, "This page does not allow scanning."));
      setView("error");
    }
  }

  function cancelRequest() {
    activeRequest.current?.abort();
    setView(scan ? "empty" : "empty");
  }

  async function retry() {
    if (scan) await solve(scan);
    else await startScan();
  }

  async function submitFollowUp(event: FormEvent) {
    event.preventDefault();
    const question = followUp.trim();
    if (!question || !scan || asking) return;

    const userMessage: ChatMessage = { role: "user", content: question };
    const nextConversation = [...conversation, userMessage];
    setConversation(nextConversation);
    setFollowUp("");
    setAsking(true);

    try {
      if (!solution) throw new Error("The original solution is no longer available.");
      const result = await askFollowUp(scan.imageDataUrl, question, conversation, solution);
      setConversation([
        ...nextConversation,
        { role: "assistant", content: result.answer }
      ]);
    } catch (requestError) {
      setConversation([
        ...nextConversation,
        { role: "assistant", content: readError(requestError) }
      ]);
    } finally {
      setAsking(false);
    }
  }

  async function copySolution() {
    if (!solution) return;
    const steps = solution.steps
      .map((step, index) => `${index + 1}. ${step.title}\n${step.explanation}${step.work ? `\n${step.work}` : ""}`)
      .join("\n\n");
    await navigator.clipboard.writeText(`Answer: ${solution.answer}\n\n${steps}`);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div>
            <div className="brand-name">Scan &amp; Solve</div>
            <div className="brand-caption">Instant step-by-step help</div>
          </div>
        </div>
        <button className="icon-button" onClick={startScan} aria-label="Scan another question" title="Scan another question">
          <ScanIcon />
        </button>
      </header>

      <section className="content">
        {view === "empty" && <EmptyState onScan={startScan} />}
        {view === "solving" && <SolvingState scan={scan} onCancel={cancelRequest} />}
        {view === "error" && <ErrorState message={error} onRetry={retry} onScan={startScan} />}
        {view === "solved" && solution && scan && (
          <SolvedState
            scan={scan}
            solution={solution}
            conversation={conversation}
            followUp={followUp}
            asking={asking}
            onFollowUpChange={setFollowUp}
            onFollowUpSubmit={submitFollowUp}
            onCopy={copySolution}
            onNewScan={startScan}
          />
        )}
      </section>
    </main>
  );
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-visual" aria-hidden="true">
        <div className="corner top-left" /><div className="corner top-right" />
        <div className="corner bottom-left" /><div className="corner bottom-right" />
        <QuestionIcon />
      </div>
      <p className="eyebrow">READY WHEN YOU ARE</p>
      <h1>Scan any question</h1>
      <p className="muted">Drag around a question on the page and get a clear answer with every step explained.</p>
      <button className="primary-button" onClick={onScan}><ScanIcon /> Start scanning</button>
      <div className="shortcut"><kbd>⌘</kbd><kbd>⇧</kbd><kbd>S</kbd><span>to scan anytime</span></div>
    </div>
  );
}

function SolvingState({ scan, onCancel }: { scan: ScanState | null; onCancel: () => void }) {
  return (
    <div className="stack">
      {scan && <QuestionPreview scan={scan} />}
      <div className="solving-card">
        <div className="spinner" aria-hidden="true" />
        <h2>Working through it…</h2>
        <p>Reading the question and preparing each step.</p>
        <button className="text-button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry, onScan }: { message: string; onRetry: () => void; onScan: () => void }) {
  return (
    <div className="empty-state">
      <div className="error-icon">!</div>
      <p className="eyebrow error-text">SOMETHING WENT WRONG</p>
      <h1>We couldn’t solve that</h1>
      <p className="muted">{message}</p>
      <button className="primary-button" onClick={onRetry}>Try again</button>
      <button className="secondary-button" onClick={onScan}>Scan a different question</button>
    </div>
  );
}

type SolvedStateProps = {
  scan: ScanState;
  solution: SolutionResponse;
  conversation: ChatMessage[];
  followUp: string;
  asking: boolean;
  onFollowUpChange: (value: string) => void;
  onFollowUpSubmit: (event: FormEvent) => void;
  onCopy: () => void;
  onNewScan: () => void;
};

function SolvedState(props: SolvedStateProps) {
  const { scan, solution, conversation, followUp, asking, onFollowUpChange, onFollowUpSubmit, onCopy, onNewScan } = props;
  return (
    <div className="stack solved-view">
      <QuestionPreview scan={scan} interpretedQuestion={solution.interpretedQuestion} />

      <section className="answer-card">
        <p className="answer-label">ANSWER</p>
        <div className="answer-value">{solution.answer}</div>
      </section>

      <section className="steps-section">
        <div className="section-heading">
          <div><p className="eyebrow">HOW TO SOLVE IT</p><h2>Step-by-step</h2></div>
          <button className="icon-button small" onClick={onCopy} aria-label="Copy solution" title="Copy solution"><CopyIcon /></button>
        </div>
        <ol className="steps-list">
          {solution.steps.map((step, index) => (
            <li key={`${step.title}-${index}`}>
              <div className="step-number">{index + 1}</div>
              <div className="step-body">
                <h3>{step.title}</h3>
                <p>{step.explanation}</p>
                {step.work && <pre>{step.work}</pre>}
              </div>
            </li>
          ))}
        </ol>
        {solution.note && <div className="note">{solution.note}</div>}
      </section>

      {conversation.length > 0 && (
        <section className="conversation" aria-label="Follow-up conversation">
          {conversation.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>{message.content}</div>
          ))}
          {asking && <div className="message assistant typing">Thinking…</div>}
        </section>
      )}

      <form className="follow-up" onSubmit={onFollowUpSubmit}>
        <label htmlFor="follow-up-input">Ask a follow-up</label>
        <div className="input-row">
          <input
            id="follow-up-input"
            value={followUp}
            onChange={(event) => onFollowUpChange(event.target.value)}
            placeholder="Why did you do step 2?"
            disabled={asking}
          />
          <button type="submit" disabled={!followUp.trim() || asking} aria-label="Send follow-up"><ArrowIcon /></button>
        </div>
      </form>

      <button className="new-scan-button" onClick={onNewScan}><ScanIcon /> Scan another question</button>
    </div>
  );
}

function QuestionPreview({ scan, interpretedQuestion }: { scan: ScanState; interpretedQuestion?: string }) {
  return (
    <section className="question-card">
      <div className="preview-image-wrap"><img src={scan.imageDataUrl} alt="Selected question" /></div>
      {interpretedQuestion && <p className="interpreted">{interpretedQuestion}</p>}
    </section>
  );
}

function ScanIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" /></svg>; }
function QuestionIcon() { return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17 18.5a7.2 7.2 0 1 1 9.5 6.8c-1.6.6-2.5 1.8-2.5 3.7v1"/><path d="M24 36.5v.5"/></svg>; }
function CopyIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>; }
function ArrowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4.5 14-3-5.5L5 12Z"/><path d="m11.5 13.5 3-3"/></svg>; }

function readError(error: unknown, fallback = "Please try again."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

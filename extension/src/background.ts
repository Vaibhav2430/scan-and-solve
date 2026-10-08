import { cropScreenshot } from "./crop";
import type { ScanErrorState, ScanRegionMessage, ScanState } from "./types";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.windowId) return;

  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["capture.js"]
    });
  } catch (error) {
    await saveError(readError(error, "This page does not allow scanning."));
  }
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isScanRegionMessage(message)) return false;

  void handleScan(message, sender.tab?.windowId)
    .then(() => sendResponse({ ok: true }))
    .catch(async (error: unknown) => {
      const message = readError(error, "The selected area could not be captured.");
      await saveError(message);
      sendResponse({ ok: false, error: message });
    });

  return true;
});

async function handleScan(message: ScanRegionMessage, windowId?: number): Promise<void> {
  if (windowId === undefined) throw new Error("The browser window could not be found.");

  const screenshot = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const imageDataUrl = await cropScreenshot(screenshot, message.rect, message.viewport);
  const scan: ScanState = {
    id: crypto.randomUUID(),
    imageDataUrl,
    createdAt: Date.now()
  };

  await chrome.storage.session.set({ currentScan: scan });
  await chrome.storage.session.remove("scanError");
}

async function saveError(message: string): Promise<void> {
  const error: ScanErrorState = { message, createdAt: Date.now() };
  await chrome.storage.session.set({ scanError: error });
  await chrome.storage.session.remove("currentScan");
}

function isScanRegionMessage(value: unknown): value is ScanRegionMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScanRegionMessage>;
  return candidate.type === "SCAN_REGION" && Boolean(candidate.rect && candidate.viewport);
}

function readError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

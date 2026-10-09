import type { ScanRect, ScanRegionMessage } from "./types";

(() => {
const ROOT_ID = "scan-and-solve-selection-root";
document.getElementById(ROOT_ID)?.remove();

const root = document.createElement("div");
root.id = ROOT_ID;
root.style.cssText = [
  "position:fixed",
  "inset:0",
  "z-index:2147483647",
  "cursor:crosshair",
  "background:rgba(7,12,23,.18)",
  "user-select:none",
  "touch-action:none"
].join(";");

const hint = document.createElement("div");
hint.textContent = "Drag around the question  •  Esc to cancel";
hint.style.cssText = [
  "position:fixed",
  "top:18px",
  "left:50%",
  "transform:translateX(-50%)",
  "padding:10px 15px",
  "border-radius:999px",
  "background:#111827",
  "color:white",
  "font:600 13px/1.2 system-ui,sans-serif",
  "box-shadow:0 8px 30px rgba(0,0,0,.22)",
  "pointer-events:none"
].join(";");

const selection = document.createElement("div");
selection.style.cssText = [
  "position:fixed",
  "display:none",
  "border:2px solid #6d5dfc",
  "border-radius:8px",
  "background:rgba(255,255,255,.08)",
  "box-shadow:0 0 0 99999px rgba(7,12,23,.48)",
  "pointer-events:none"
].join(";");

root.append(hint, selection);
document.documentElement.append(root);

let startX = 0;
let startY = 0;
let dragging = false;

root.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  startX = event.clientX;
  startY = event.clientY;
  dragging = true;
  selection.style.display = "block";
  updateSelection(toRect(startX, startY, startX, startY));
  root.setPointerCapture(event.pointerId);
});

root.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  event.preventDefault();
  updateSelection(toRect(startX, startY, event.clientX, event.clientY));
});

root.addEventListener("pointerup", (event) => {
  if (!dragging) return;
  dragging = false;
  const rect = toRect(startX, startY, event.clientX, event.clientY);

  if (rect.width < 20 || rect.height < 20) {
    selection.style.display = "none";
    return;
  }

  cleanup();
  window.setTimeout(() => {
    const message: ScanRegionMessage = {
      type: "SCAN_REGION",
      rect,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
    void chrome.runtime.sendMessage(message);
  }, 80);
});

document.addEventListener("keydown", onKeyDown, true);

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  cleanup();
}

function cleanup(): void {
  document.removeEventListener("keydown", onKeyDown, true);
  root.remove();
}

function toRect(x1: number, y1: number, x2: number, y2: number): ScanRect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

function updateSelection(rect: ScanRect): void {
  selection.style.left = `${rect.x}px`;
  selection.style.top = `${rect.y}px`;
  selection.style.width = `${rect.width}px`;
  selection.style.height = `${rect.height}px`;
}
})();

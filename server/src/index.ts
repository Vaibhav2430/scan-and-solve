import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createSolver } from "./solver.ts";
import { MAX_BODY_BYTES, parseFollowUpRequest, parseSolveRequest } from "./validation.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const solver = createSolver();

const server = createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", mode: "demo" });
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    if (request.url === "/api/solve") {
      sendJson(response, 200, await solver.solve(parseSolveRequest(body)));
      return;
    }
    if (request.url === "/api/follow-up") {
      sendJson(response, 200, await solver.followUp(parseFollowUpRequest(body)));
      return;
    }
    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The request could not be processed.";
    const status = message === "Request body is too large." ? 413 : 400;
    sendJson(response, status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Scan & Solve server running at http://${HOST}:${PORT} (demo mode)`);
});

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

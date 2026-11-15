import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalEnvironment } from "../server/src/config.ts";
import { createSolver } from "../server/src/solver.ts";

const cases = [
  {
    id: "arithmetic",
    question: "Calculate 17 × 6.",
    check: (solution) => hasNumber(solution.answer, "102")
  },
  {
    id: "algebra",
    question: "Solve for x: 3x + 5 = 20.",
    check: (solution) => /x=?5(?:\D|$)/i.test(compact(solution.answer))
  },
  {
    id: "fractions",
    question: "Compute and simplify: 3/4 + 2/3.",
    check: (solution) => {
      const answer = compact(solution.answer);
      return answer.includes("17/12") || answer.includes("frac{17}{12}") || answer.includes("1\\frac{5}{12}");
    }
  },
  {
    id: "square-root",
    question: "Simplify: √144.",
    check: (solution) => hasNumber(solution.answer, "12")
  },
  {
    id: "matrix",
    question: "Find the determinant of the matrix:\n[ 2  1 ]\n[ 3  4 ]",
    check: (solution) => hasNumber(solution.answer, "5")
  },
  {
    id: "calculus",
    question: "Differentiate with respect to x:\nf(x) = x³ + 2x.",
    check: (solution) => /3x(?:\^?\{?2\}?|²)\+2/i.test(compact(solution.answer))
  },
  {
    id: "multiple-choice",
    question: "Which number is prime?\nA. 21    B. 29    C. 39    D. 51",
    check: (solution) => hasNumber(solution.answer, "29"),
    expectsMath: false
  },
  {
    id: "code",
    question: "What does this JavaScript print?\nconsole.log([1, 2, 3].map(x => x * 2));",
    check: (solution) => compact(solution.answer).includes("[2,4,6]"),
    expectsMath: false
  },
  {
    id: "word-problem",
    question: "A box holds 8 rows of 6 pencils. If 13 pencils are removed, how many remain?",
    check: (solution) => hasNumber(solution.answer, "35")
  },
  {
    id: "incomplete-input",
    question: "Solve for x: 2x +",
    check: (solution) => /incomplete|missing|cannot|can't|not enough|unclear/i.test(
      [solution.answer, solution.note, ...solution.steps.map((step) => step.explanation)].filter(Boolean).join(" ")
    ),
    expectsMath: false
  }
];
const requestedCase = process.argv[2];
const selectedCases = requestedCase ? cases.filter((testCase) => testCase.id === requestedCase) : cases;
if (selectedCases.length === 0) {
  console.error(`Unknown evaluation case: ${requestedCase}`);
  process.exit(2);
}

loadLocalEnvironment();
const solver = createSolver();
if (solver.mode !== "gemini") {
  console.error("Live evaluation requires a configured Gemini key in server/.env.");
  process.exit(2);
}

const fixtureDirectory = mkdtempSync(join(tmpdir(), "scan-and-solve-eval-"));
const startedAt = new Date();
const results = [];
let algebraContext;

try {
  const images = renderFixtures(fixtureDirectory, selectedCases);
  for (let index = 0; index < selectedCases.length; index += 1) {
    const testCase = selectedCases[index];
    process.stdout.write(`[${index + 1}/${selectedCases.length}] ${testCase.id} ... `);
    try {
      const imageDataUrl = `data:image/png;base64,${readFileSync(images.get(testCase.id)).toString("base64")}`;
      const start = performance.now();
      const solution = await solver.solve({ imageDataUrl });
      const latencyMs = Math.round(performance.now() - start);
      const correct = testCase.check(solution);
      const mathFormatted = testCase.expectsMath === false || containsMathMarkup(solution);
      const passed = correct && mathFormatted;
      results.push({
        id: testCase.id,
        passed,
        correct,
        mathFormatted,
        latencyMs,
        answer: solution.answer,
        note: solution.note
      });
      if (testCase.id === "algebra") algebraContext = { imageDataUrl, solution };
      console.log(`${passed ? "PASS" : "FAIL"} (${latencyMs} ms) — ${oneLine(solution.answer)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id: testCase.id, passed: false, error: message });
      console.log(`ERROR — ${message}`);
    }
    if (index < selectedCases.length - 1) await delay(1_000);
  }

  if (algebraContext) {
    process.stdout.write("[follow-up] algebra explanation ... ");
    try {
      const start = performance.now();
      const response = await solver.followUp({
        imageDataUrl: algebraContext.imageDataUrl,
        question: "Why do we subtract 5 first?",
        conversation: [],
        solution: algebraContext.solution
      });
      const latencyMs = Math.round(performance.now() - start);
      const correct = /subtract|isolate|both sides/i.test(response.answer);
      const mathFormatted = response.answer.includes("\\(") || response.answer.includes("\\[");
      const passed = correct && mathFormatted;
      results.push({ id: "follow-up", passed, correct, mathFormatted, latencyMs, answer: response.answer });
      console.log(`${passed ? "PASS" : "FAIL"} (${latencyMs} ms) — ${oneLine(response.answer)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id: "follow-up", passed: false, error: message });
      console.log(`ERROR — ${message}`);
    }
  }
} finally {
  rmSync(fixtureDirectory, { recursive: true, force: true });
}

const passed = results.filter((result) => result.passed).length;
const latencies = results.flatMap((result) => typeof result.latencyMs === "number" ? [result.latencyMs] : []);
const averageLatencyMs = latencies.length
  ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
  : undefined;
const report = {
  generatedAt: new Date().toISOString(),
  model: solver.model,
  summary: { passed, total: results.length, averageLatencyMs },
  results
};
const reportPath = requestedCase ? `evaluation-results-${requestedCase}.json` : "evaluation-results.json";
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`\nResult: ${passed}/${results.length} passed.`);
if (averageLatencyMs !== undefined) console.log(`Average response time: ${(averageLatencyMs / 1_000).toFixed(1)} seconds.`);
console.log(`Elapsed time: ${Math.round((Date.now() - startedAt.getTime()) / 1_000)} seconds.`);
console.log(`Detailed report: ${reportPath}`);
process.exitCode = passed === results.length ? 0 : 1;

function renderFixtures(directory, definitions) {
  const svgPaths = [];
  const images = new Map();
  for (const definition of definitions) {
    const svgPath = join(directory, `${definition.id}.svg`);
    writeFileSync(svgPath, createSvg(definition.question));
    svgPaths.push(svgPath);
    images.set(definition.id, `${svgPath}.png`);
  }
  execFileSync("qlmanage", ["-t", "-s", "1200", "-o", directory, ...svgPaths], { stdio: "ignore" });
  return images;
}

function createSvg(question) {
  const lines = wrapLines(question, 46);
  const text = lines.map((line, index) => (
    `<text x="60" y="${95 + index * 58}" font-family="Arial, sans-serif" font-size="38" fill="#111827">${escapeXml(line)}</text>`
  )).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="420" viewBox="0 0 1000 420"><rect width="1000" height="420" fill="white"/>${text}</svg>`;
}

function wrapLines(value, maximumLength) {
  return value.split("\n").flatMap((sourceLine) => {
    if (sourceLine.length <= maximumLength) return [sourceLine];
    const output = [];
    let line = "";
    for (const word of sourceLine.split(" ")) {
      if (!line || `${line} ${word}`.length <= maximumLength) {
        line = line ? `${line} ${word}` : word;
      } else {
        output.push(line);
        line = word;
      }
    }
    if (line) output.push(line);
    return output;
  });
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function compact(value) {
  return value.toLowerCase().replaceAll("\\(", "").replaceAll("\\)", "").replaceAll("\\[", "").replaceAll("\\]", "").replaceAll("$", "").replaceAll(" ", "");
}

function hasNumber(value, expected) {
  return new RegExp(`(^|\\D)${expected.replace("-", "\\-")}(?:\\D|$)`).test(value);
}

function containsMathMarkup(solution) {
  const text = [
    solution.answer,
    solution.interpretedQuestion,
    ...solution.steps.flatMap((step) => [step.title, step.explanation, step.work]),
    solution.note
  ].filter(Boolean).join(" ");
  return text.includes("\\(") || text.includes("\\[") || text.includes("$$");
}

function oneLine(value) {
  return value.replaceAll("\n", " ").slice(0, 110);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

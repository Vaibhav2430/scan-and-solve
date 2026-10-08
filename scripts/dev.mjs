import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const processes = [
  spawn(npmCommand, ["run", "dev", "--workspace", "extension"], { stdio: "inherit" }),
  spawn(npmCommand, ["run", "dev", "--workspace", "server"], { stdio: "inherit" })
];

function stop() {
  for (const child of processes) child.kill("SIGTERM");
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

for (const child of processes) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      stop();
      process.exitCode = code;
    }
  });
}

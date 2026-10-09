import { readFileSync } from "node:fs";

export function loadLocalEnvironment(): void {
  const envUrl = new URL("../.env", import.meta.url);
  let source: string;

  try {
    source = readFileSync(envUrl, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || process.env[key] !== undefined) continue;
    process.env[key] = unquote(rawValue);
  }
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

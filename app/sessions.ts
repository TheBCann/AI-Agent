import type { Message } from "./types";
import * as fs from "fs";
import * as path from "path";

const SESSIONS_DIR = ".claude/sessions";

export function generateSessionId(): string {
  return crypto.randomUUID();
}

function sessionPath(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.jsonl`);
}

function ensureSessionsDir(): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

export function appendMessage(sessionId: string, message: Message): void {
  ensureSessionsDir();
  fs.appendFileSync(sessionPath(sessionId), JSON.stringify(message) + "\n");
}

export function loadSession(sessionId: string): Message[] {
  const filePath = sessionPath(sessionId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return fs
    .readFileSync(filePath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Message);
}

export function loadLastSession(): { id: string; messages: Message[] } {
  ensureSessionsDir();
  const files = fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    throw new Error("No sessions found.");
  }

  const id = files[0].name.replace(/\.jsonl$/, "");
  return { id, messages: loadSession(id) };
}

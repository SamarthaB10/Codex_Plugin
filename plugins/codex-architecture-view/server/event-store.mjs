import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const dataRoot = join(homedir(), ".codex", "architecture-view");

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function pathFor(threadId) {
  return join(dataRoot, `${safeId(threadId)}.json`);
}

export async function readEvents(threadId) {
  try {
    const value = JSON.parse(await readFile(pathFor(threadId), "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function appendEvent(threadId, event) {
  const path = pathFor(threadId);
  const events = await readEvents(threadId);
  events.push({ ...event, sequence: events.length + 1, occurredAt: new Date().toISOString() });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(events.slice(-500), null, 2));
  return events.at(-1);
}

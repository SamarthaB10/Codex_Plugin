import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LiveViewServer } from "../server/live-view-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("serves live architecture state outside the task message", async (context) => {
  let notify;
  let revision = 1;
  const service = new LiveViewServer({
    client: { onNotification(listener) { notify = listener; return () => {}; } },
    htmlPath: resolve(root, "dist/architecture-view.html"),
    listTasks: async () => [{ id: "task-1", name: "Live task" }],
    readState: async (threadId) => ({ thread: { id: threadId }, revision }),
    sendMessage: async (threadId, message) => ({ threadId, message }),
  });
  await service.start();
  context.after(async () => service.close());

  const tasks = await fetch(`${service.viewerUrl() }api/tasks`).then((response) => response.json());
  assert.deepEqual(tasks, { tasks: [{ id: "task-1", name: "Live task" }] });

  const state = await fetch(`${service.viewerUrl() }api/state?threadId=task-1`).then((response) => response.json());
  assert.deepEqual(state, { thread: { id: "task-1" }, revision: 1 });

  const controller = new AbortController();
  context.after(() => controller.abort());
  const stream = await fetch(`${service.viewerUrl() }api/events?threadId=task-1`, { signal: controller.signal });
  const reader = stream.body.getReader();
  const first = await readUntil(reader, '"revision":1');
  assert.match(first, /event: state/);
  assert.match(first, /"revision":1/);

  revision = 2;
  notify({ method: "turn/completed" });
  const second = await readUntil(reader, '"revision":2');
  assert.match(second, /event: state/);
});

async function readUntil(reader, expected) {
  let text = "";
  while (!text.includes(expected)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += new TextDecoder().decode(chunk.value);
  }
  return text;
}

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { CodexAppServerClient } from "./app-server-client.mjs";
import { appendEvent, readEvents } from "./event-store.mjs";
import { LiveViewServer } from "./live-view-server.mjs";
import { projectThread } from "./projector.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateUri = "ui://codex-architecture-view/live-v1.html";
const uiMimeType = "text/html;profile=mcp-app";
const client = new CodexAppServerClient();
let activeThreadId = null;

function metadataThreadId(extra) {
  const source = JSON.stringify(extra || {});
  return source.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || null;
}

async function selectThread(explicitThreadId, extra) {
  const candidate = explicitThreadId || metadataThreadId(extra) || activeThreadId;
  if (candidate) {
    activeThreadId = candidate;
    return candidate;
  }
  const threads = await client.listThreads();
  if (!threads[0]?.id) throw new Error("No Codex tasks are available");
  activeThreadId = threads[0].id;
  return activeThreadId;
}

async function stateFor(threadId) {
  const thread = await client.readThread(threadId);
  return projectThread(thread, await readEvents(threadId));
}

async function taskSummaries() {
  return (await client.listThreads()).map((thread) => ({
    id: thread.id,
    name: thread.name || thread.preview || "Untitled task",
    preview: thread.preview || "",
    cwd: thread.cwd || "",
    status: thread.status?.type || "unknown",
    updatedAt: thread.updatedAt || null,
  }));
}

async function sendTaskMessage(threadId, message) {
  const selectedId = await selectThread(threadId);
  if (typeof message !== "string" || !message.trim()) throw new Error("A message is required");
  const turnId = await client.sendMessage(selectedId, message.trim());
  return { threadId: selectedId, turnId };
}

function textResult(text, structuredContent, withUi = false) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    ...(withUi ? { _meta: { ui: { resourceUri: templateUri }, "openai/outputTemplate": templateUri } } : {}),
  };
}

const server = new McpServer({ name: "codex-architecture-view", version: "0.1.0" });

server.registerResource("architecture-view", templateUri, {
  title: "Codex Architecture View",
  description: "Live Codex task architecture, agents, events, and messaging.",
  mimeType: uiMimeType,
}, async () => ({
  contents: [{
    uri: templateUri,
    mimeType: uiMimeType,
    text: await readFile(resolve(root, "dist/architecture-view.html"), "utf8"),
    _meta: { ui: { prefersBorder: false } },
  }],
}));

server.registerTool("open_architecture_view", {
  title: "Visualize architecture",
  description: "Open the live architecture view for the current or selected Codex task.",
  inputSchema: { threadId: z.string().optional().describe("Codex task ID. Omit it to use the active or most recent task.") },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ threadId }, extra) => {
  const selectedId = await selectThread(threadId, extra);
  const state = await stateFor(selectedId);
  return textResult(`The live architecture service is ready for ${state.thread.name}.`, {
    ...state,
    viewerUrl: liveView.viewerUrl(selectedId),
  });
});

server.registerTool("list_codex_tasks", {
  title: "List Codex tasks",
  description: "List recent Codex tasks that can be shown in Architecture View.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async () => {
  const tasks = await taskSummaries();
  return textResult(`Found ${tasks.length} Codex tasks.`, { tasks });
});

server.registerTool("get_architecture_state", {
  title: "Refresh architecture",
  description: "Read the latest architecture, agent, conversation, and event state for a Codex task.",
  inputSchema: { threadId: z.string().optional() },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ threadId }, extra) => {
  const selectedId = await selectThread(threadId, extra);
  return textResult("Architecture state refreshed.", await stateFor(selectedId));
});

const nodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
  nodeKind: z.enum(["system", "service", "module", "component", "endpoint", "mapping", "worker", "queue", "store"]).optional(),
  status: z.enum(["thinking", "working", "testing", "settled", "blocked", "failed"]).optional(),
  verification: z.enum(["unverified", "verified", "failed"]).optional(),
  affectedFiles: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional(),
});

const relationshipSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.enum(["contains", "calls", "maps-to", "reads-from", "writes-to", "depends-on"]),
  label: z.string(),
  verification: z.enum(["unverified", "verified", "failed"]),
});

server.registerTool("publish_architecture_event", {
  title: "Report architecture change",
  description: "Report one verified architecture node, relationship, or status change for the live task viewer.",
  inputSchema: {
    threadId: z.string().optional(),
    action: z.enum(["upsert-node", "set-node-status", "remove-node", "upsert-relationship", "remove-relationship"]),
    node: nodeSchema.optional(),
    relationship: relationshipSchema.optional(),
    nodeId: z.string().optional(),
    relationshipId: z.string().optional(),
    status: z.enum(["thinking", "working", "testing", "settled", "blocked", "failed"]).optional(),
    issue: z.string().optional(),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ threadId, ...event }, extra) => {
  const selectedId = await selectThread(threadId, extra);
  const recorded = await appendEvent(selectedId, event);
  await liveView.broadcast(selectedId);
  return textResult("Architecture change recorded.", { threadId: selectedId, event: recorded });
});

server.registerTool("message_codex_task", {
  title: "Message your agents",
  description: "Send guidance to the selected running Codex task.",
  inputSchema: { threadId: z.string().optional(), message: z.string().min(1).max(12000) },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ threadId, message }, extra) => {
  const selectedId = await selectThread(threadId, extra);
  return textResult("Guidance was sent to the Codex task.", await sendTaskMessage(selectedId, message));
});

const liveView = new LiveViewServer({
  client,
  htmlPath: resolve(root, "dist/architecture-view.html"),
  listTasks: taskSummaries,
  readState: async (threadId) => stateFor(await selectThread(threadId)),
  sendMessage: sendTaskMessage,
});
await liveView.start();
await server.connect(new StdioServerTransport());

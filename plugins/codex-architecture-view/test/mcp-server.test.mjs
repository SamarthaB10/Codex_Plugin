import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("exposes the complete Architecture View MCP surface", async (context) => {
  const transport = new StdioClientTransport({ command: "node", args: ["server/index.mjs"], cwd: root });
  const client = new Client({ name: "architecture-view-test", version: "0.1.0" }, { capabilities: {} });
  context.after(async () => client.close());
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "get_architecture_state",
    "list_codex_tasks",
    "message_codex_task",
    "open_architecture_view",
    "publish_architecture_event",
  ]);
  const open = tools.tools.find((tool) => tool.name === "open_architecture_view");
  assert.equal(open._meta, undefined);
  const publish = tools.tools.find((tool) => tool.name === "publish_architecture_event");
  assert.deepEqual(publish.inputSchema.properties.node.required, ["id"]);
  const resource = await client.readResource({ uri: "ui://codex-architecture-view/live-v1.html" });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(resource.contents[0].text, /Message your agents/);
  assert.match(resource.contents[0].text, /EventSource/);
  assert.match(resource.contents[0].text, /localStorage/);
  assert.match(resource.contents[0].text, /pointerdown/);
  const appSource = await readFile(resolve(root, "web/app.js"), "utf8");
  assert.match(appSource, /activeDragCount/);
  assert.match(appSource, /pendingCanvasRender/);
  assert.match(resource.contents[0].text, /Nodes fitted to viewport/);
  assert.match(resource.contents[0].text, /html,body\{[^}]*min-height:100dvh/);
  assert.match(resource.contents[0].text, /\.app\{[^}]*height:100dvh[^}]*min-height:0/);
  assert.match(resource.contents[0].text, /\.app\{[^}]*grid-template-rows:auto auto minmax\(0,1fr\)/);
  assert.match(resource.contents[0].text, /\.workspace\{[^}]*height:100%[^}]*overflow:hidden/);
  assert.match(resource.contents[0].text, /\.canvas-wrap,\.rail\{height:100%;min-height:0/);
  assert.match(resource.contents[0].text, /\.rail\{[^}]*overflow:hidden/);
  assert.match(resource.contents[0].text, /@media\(max-width:850px\)\{\.app\{height:100dvh;max-height:100dvh\}\.canvas-wrap\{min-height:0\}\.event-section\{height:auto\}/);
  assert.match(resource.contents[0].text, /@media\(max-width:560px\)\{html\[data-display-mode="pip"\] \.workspace\{grid-template-columns:minmax\(0,1fr\) minmax\(220px,38vw\)\}/);
  assert.doesNotMatch(resource.contents[0].text, /__APP_BUNDLE__/);
});

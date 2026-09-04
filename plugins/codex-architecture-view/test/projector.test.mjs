import test from "node:test";
import assert from "node:assert/strict";

import { projectThread } from "../server/projector.mjs";

test("projects reported architecture, agents, events, and conversation", () => {
  const thread = {
    id: "thread-1",
    name: "Build API",
    status: { type: "active" },
    turns: [{
      status: "inProgress",
      items: [
        { id: "u1", type: "userMessage", content: [{ type: "text", text: "Build the API" }] },
        { id: "a1", type: "agentMessage", text: "I will create the endpoint." },
        { id: "c1", type: "commandExecution", command: "npm test", status: "completed" },
        {
          id: "d1",
          type: "dynamicToolCall",
          namespace: "build_yard",
          tool: "publish_architecture_event",
          arguments: {
            action: "upsert-node",
            node: { id: "api", name: "API", role: "Serves requests", nodeKind: "service", status: "working", verification: "verified", affectedFiles: ["api.ts"], evidence: ["api.ts"] },
          },
        },
        { id: "s1", type: "subAgentActivity", agentThreadId: "child-1", agentPath: "api-agent", status: "working", message: "Build endpoint" },
      ],
    }],
  };
  const state = projectThread(thread);
  assert.equal(state.thread.id, "thread-1");
  assert.equal(state.nodes[0].name, "API");
  assert.equal(state.nodes[0].status, "working");
  assert.equal(state.agents[0].name, "api-agent");
  assert.equal(state.events[0].label, "Build endpoint");
  assert.deepEqual(state.conversation.map((entry) => entry.role), ["user", "agent"]);
});

test("uses one task node until architecture events arrive", () => {
  const state = projectThread({ id: "thread-2", preview: "New task", status: { type: "idle" }, turns: [] });
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0].id, "task");
  assert.equal(state.nodes[0].status, "settled");
});

test("preserves parent links and fields when a node upsert is partial", () => {
  const thread = {
    id: "thread-3",
    turns: [{
      status: "inProgress",
      items: [
        {
          type: "dynamicToolCall",
          namespace: "build_yard",
          tool: "publish_architecture_event",
          arguments: {
            action: "upsert-node",
            node: {
              id: "root",
              name: "Root",
              role: "System root",
              nodeKind: "system",
              status: "working",
              verification: "unverified",
            },
          },
        },
        {
          type: "dynamicToolCall",
          namespace: "build_yard",
          tool: "publish_architecture_event",
          arguments: {
            action: "upsert-node",
            node: {
              id: "child",
              parentId: "root",
              name: "Child",
              role: "Nested module",
              nodeKind: "module",
              status: "working",
              verification: "unverified",
            },
          },
        },
        {
          type: "dynamicToolCall",
          namespace: "build_yard",
          tool: "publish_architecture_event",
          arguments: {
            action: "upsert-node",
            node: { id: "child", status: "testing" },
          },
        },
      ],
    }],
  };

  const child = projectThread(thread).nodes.find((node) => node.id === "child");
  assert.equal(child?.parentId, "root");
  assert.equal(child?.name, "Child");
  assert.equal(child?.status, "testing");
});

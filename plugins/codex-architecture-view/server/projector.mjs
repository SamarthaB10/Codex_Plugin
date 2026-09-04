const nodeKinds = new Set(["system", "service", "module", "component", "endpoint", "mapping", "worker", "queue", "store"]);
const statuses = new Set(["thinking", "working", "testing", "settled", "blocked", "failed"]);

function textFromItem(item) {
  if (typeof item?.text === "string") return item.text;
  if (Array.isArray(item?.content)) return item.content.map((part) => part?.text || "").join("\n").trim();
  return "";
}

function parseArguments(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function architectureCalls(items) {
  return items.flatMap((item) => {
    const isArchitectureCall = item?.type === "dynamicToolCall"
      && item?.namespace === "build_yard"
      && item?.tool === "publish_architecture_event";
    if (!isArchitectureCall) return [];
    const event = parseArguments(item.arguments);
    return event ? [{ ...event, occurredAt: item.completedAt || item.startedAt }] : [];
  });
}

function normalizeNode(node, existing = null) {
  const has = (key) => Object.prototype.hasOwnProperty.call(node, key);
  const value = (key, fallback) => has(key) && node[key] !== undefined
    ? node[key]
    : existing?.[key] ?? fallback;
  return {
    id: String(node.id),
    parentId: has("parentId") && node.parentId !== undefined
      ? (node.parentId ? String(node.parentId) : null)
      : existing?.parentId ?? null,
    name: String(value("name", node.id)),
    role: String(value("role", "Architecture component")),
    nodeKind: nodeKinds.has(value("nodeKind", "module")) ? value("nodeKind", "module") : "module",
    status: statuses.has(value("status", "thinking")) ? value("status", "thinking") : "thinking",
    verification: value("verification", "unverified") || "unverified",
    affectedFiles: Array.isArray(value("affectedFiles", [])) ? value("affectedFiles", []).map(String) : [],
    evidence: Array.isArray(value("evidence", [])) ? value("evidence", []).map(String) : [],
  };
}

function applyArchitectureEvent(state, event) {
  if (event.action === "upsert-node" && event.node?.id) {
    const id = String(event.node.id);
    state.nodes.set(id, normalizeNode(event.node, state.nodes.get(id) || null));
  }
  if (event.action === "set-node-status" && event.nodeId && state.nodes.has(String(event.nodeId))) {
    const node = state.nodes.get(String(event.nodeId));
    state.nodes.set(String(event.nodeId), { ...node, status: statuses.has(event.status) ? event.status : node.status, issue: event.issue || null });
  }
  if (event.action === "remove-node" && event.nodeId) state.nodes.delete(String(event.nodeId));
  if (event.action === "upsert-relationship" && event.relationship?.id) state.relationships.set(String(event.relationship.id), { ...event.relationship });
  if (event.action === "remove-relationship" && event.relationshipId) state.relationships.delete(String(event.relationshipId));
}

function eventLabel(item) {
  if (item.type === "commandExecution") return item.command ? `Run ${item.command}` : "Run command";
  if (item.type === "fileChange") return `Apply ${(item.changes || []).length} file changes`;
  if (item.type === "mcpToolCall") return `Use ${item.server || "MCP"}.${item.tool || "tool"}`;
  if (item.type === "dynamicToolCall") return `Use ${item.namespace ? `${item.namespace}.` : ""}${item.tool || "tool"}`;
  if (item.type === "collabAgentToolCall") return item.prompt || item.tool || "Coordinate agent";
  if (item.type === "subAgentActivity") return item.message || item.prompt || "Agent activity";
  return item.type || "Task activity";
}

export function projectThread(thread, storedEvents = []) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const items = turns.flatMap((turn) => Array.isArray(turn?.items) ? turn.items.map((item) => ({ ...item, turnStatus: turn.status })) : []);
  const state = { nodes: new Map(), relationships: new Map() };
  const projectedEvents = [...architectureCalls(items), ...storedEvents];
  for (const event of projectedEvents) applyArchitectureEvent(state, event);

  if (state.nodes.size === 0) {
    state.nodes.set("task", normalizeNode({
      id: "task",
      name: thread?.name || thread?.preview || "Codex task",
      role: "The active Codex task. Architecture nodes appear as the agent reports them.",
      nodeKind: "system",
      status: thread?.status?.type === "active" ? "working" : "settled",
      verification: "unverified",
    }));
  }

  const agents = new Map();
  for (const item of items) {
    if (item.type === "subAgentActivity" && item.agentThreadId) {
      agents.set(item.agentThreadId, {
        id: item.agentThreadId,
        name: item.agentPath || "Subagent",
        status: item.status || item.kind || "working",
        activity: item.message || item.prompt || "Agent work",
      });
    }
    if (item.type === "collabAgentToolCall" && item.agentsStates) {
      for (const [id, value] of Object.entries(item.agentsStates)) agents.set(id, {
        id,
        name: id.split("/").at(-1) || "Agent",
        status: value?.status || "working",
        activity: value?.message || item.prompt || item.tool || "Agent work",
      });
    }
  }

  const conversation = items.flatMap((item) => {
    if (item.type !== "userMessage" && item.type !== "agentMessage") return [];
    const text = textFromItem(item);
    return text ? [{ id: item.id, role: item.type === "userMessage" ? "user" : "agent", text }] : [];
  }).slice(-60);

  const activity = items.filter((item) => !["userMessage", "agentMessage", "reasoning"].includes(item.type)).map((item, index) => ({
    id: item.id || `event-${index}`,
    type: item.type || "activity",
    label: eventLabel(item),
    status: item.status || item.turnStatus || "recorded",
  })).slice(-120).reverse();

  const rootStatus = turns.at(-1)?.status || thread?.status?.type || "idle";
  return {
    thread: {
      id: String(thread?.id || ""),
      name: thread?.name || thread?.preview || "Untitled task",
      preview: thread?.preview || "",
      cwd: thread?.cwd || "",
      status: rootStatus,
      updatedAt: thread?.updatedAt || null,
    },
    nodes: [...state.nodes.values()],
    relationships: [...state.relationships.values()],
    agents: [...agents.values()],
    events: activity,
    conversation,
    revision: projectedEvents.length + activity.length,
  };
}

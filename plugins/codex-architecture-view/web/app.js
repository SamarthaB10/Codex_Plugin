import { downloadNodesPng } from "./node-export.js";
import { zoomViewport } from "./zoom.js";
import { App } from "@modelcontextprotocol/ext-apps";
import { createCanvasRenderGate, draggedPosition } from "./drag-state.js";

const ui = new App({ name: "codex-architecture-view", version: "0.1.0" }, {}, { autoResize: true });
const byId = (id) => document.getElementById(id);
const positions = new Map();
let positionTaskId = null;
let state = null;
let tasks = [];
let refreshTimer = null;
let refreshing = false;
let eventSource = null;
let fitScale = 1;
const standalone = window.parent === window;
const canvasRenderGate = createCanvasRenderGate(() => renderCanvas());

function positionStorageKey(threadId) {
  return `codex-architecture-view:positions:${threadId}`;
}

function loadPositions(threadId) {
  positions.clear();
  positionTaskId = threadId || null;
  if (!positionTaskId) return;
  try {
    const stored = JSON.parse(window.localStorage.getItem(positionStorageKey(positionTaskId)) || "{}");
    for (const [nodeId, value] of Object.entries(stored)) {
      if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
        positions.set(nodeId, { x: Math.max(0, value.x), y: Math.max(0, value.y) });
      }
    }
  } catch {
    // Storage can be unavailable in a restricted Codex panel.
  }
}

function savePositions() {
  if (!positionTaskId) return;
  try {
    window.localStorage.setItem(positionStorageKey(positionTaskId), JSON.stringify(Object.fromEntries(positions)));
  } catch {
    // Storage can be unavailable in a restricted Codex panel.
  }
}

function structured(result) {
  return result?.structuredContent || result?.params?.structuredContent || result?.toolOutput || null;
}

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function statusClass(value) {
  if (["working", "inProgress", "active", "running"].includes(value)) return "working";
  if (["testing"].includes(value)) return "testing";
  if (["settled", "completed", "idle"].includes(value)) return "settled";
  if (["failed", "blocked", "interrupted"].includes(value)) return "failed";
  return "thinking";
}

function positionNodes(nodes) {
  const children = new Map();
  for (const node of nodes) {
    const parent = node.parentId || "__root";
    children.set(parent, [...(children.get(parent) || []), node]);
  }
  const roots = children.get("__root") || nodes.filter((node) => !nodes.some((item) => item.id === node.parentId));
  const visited = new Set();
  function walk(node, depth, row) {
    if (visited.has(node.id)) return row;
    visited.add(node.id);
    if (!positions.has(node.id)) positions.set(node.id, { x: 34 + depth * 280, y: 26 + row * 150 });
    let next = row + 1;
    for (const child of children.get(node.id) || []) next = walk(child, depth + 1, next);
    return next;
  }
  let row = 0;
  for (const root of roots) row = walk(root, 0, row);
  for (const node of nodes) if (!visited.has(node.id)) row = walk(node, 0, row);
}

function createNode(node) {
  const element = document.createElement("article");
  element.className = "node";
  element.dataset.nodeId = node.id;
  element.dataset.status = statusClass(node.status);
  const kind = document.createElement("div");
  kind.className = "node-kind";
  kind.textContent = node.nodeKind || "module";
  const title = document.createElement("div");
  title.className = "node-title";
  title.textContent = node.name;
  const role = document.createElement("div");
  role.className = "node-role";
  role.textContent = node.role;
  const status = document.createElement("span");
  status.className = "node-status";
  status.textContent = node.status;
  element.append(kind, title, role, status);
  let frame = 0;
  let drag = null;
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    const current = positions.get(node.id);
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: current.x, y: current.y };
    canvasRenderGate.startDrag();
    element.setPointerCapture(event.pointerId);
    element.classList.add("dragging");
  });
  element.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const next = draggedPosition(
      { x: drag.x, y: drag.y },
      { x: drag.startX, y: drag.startY },
      { x: event.clientX, y: event.clientY },
      fitScale,
    );
    positions.set(node.id, next);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      element.style.transform = `translate3d(${next.x}px,${next.y}px,0)`;
      renderEdges();
    });
  });
  const stop = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    element.classList.remove("dragging");
    savePositions();
    canvasRenderGate.stopDrag();
  };
  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);
  element.addEventListener("lostpointercapture", stop);
  return element;
}

function nodeLayerBounds() {
  const currentIds = new Set((state?.nodes || []).map((node) => node.id));
  const heights = new Map([...byId("node-layer").querySelectorAll(".node")].map((node) => [node.dataset.nodeId, node.offsetHeight]));
  const currentPositions = [...positions.entries()]
    .filter(([nodeId]) => currentIds.has(nodeId))
    .map(([nodeId, value]) => ({ ...value, height: heights.get(nodeId) || 160 }));
  return {
    maxX: Math.max(760, ...currentPositions.map((value) => value.x + 260)),
    maxY: Math.max(500, ...currentPositions.map((value) => value.y + value.height + 24)),
  };
}

function renderEdges() {
  if (!state) return;
  const svg = byId("edges");
  const layer = byId("node-layer");
  const { maxX, maxY } = nodeLayerBounds();
  layer.style.width = `${maxX}px`;
  layer.style.height = `${maxY}px`;
  updateCanvasSize();
  svg.setAttribute("width", maxX);
  svg.setAttribute("height", maxY);
  svg.replaceChildren();
  for (const relation of state.relationships || []) {
    const from = positions.get(relation.from);
    const to = positions.get(relation.to);
    if (!from || !to) continue;
    const x1 = from.x + 220;
    const y1 = from.y + 56;
    const x2 = to.x;
    const y2 = to.y + 56;
    const bend = Math.max(50, Math.abs(x2 - x1) * .45);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "edge");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "edge-label");
    label.setAttribute("x", String((x1 + x2) / 2));
    label.setAttribute("y", String((y1 + y2) / 2 - 7));
    label.setAttribute("text-anchor", "middle");
    label.textContent = relation.label || relation.kind;
    svg.append(path, label);
  }
}

function updateCanvasSize() {
  const layer = byId("node-layer");
  const size = byId("canvas-size");
  size.style.width = `${parseFloat(layer.style.width) * fitScale}px`;
  size.style.height = `${parseFloat(layer.style.height) * fitScale}px`;
  layer.style.transform = `scale(${fitScale})`;
}

function zoomAt(factor, x, y) {
  const canvas = byId("canvas");
  const next = zoomViewport(fitScale, factor, canvas.scrollLeft, canvas.scrollTop, x, y);
  fitScale = next.scale;
  updateCanvasSize();
  canvas.scrollLeft = next.left;
  canvas.scrollTop = next.top;
}

function fitNodes() {
  const layer = byId("node-layer");
  const canvas = byId("canvas");
  const nodes = state?.nodes || [];
  if (!nodes.length || !canvas.clientWidth || !canvas.clientHeight) return false;
  const { maxX, maxY } = nodeLayerBounds();
  const availableWidth = Math.max(1, canvas.clientWidth - 32);
  const availableHeight = Math.max(1, canvas.clientHeight - 32);
  fitScale = Math.min(1, availableWidth / maxX, availableHeight / maxY);
  updateCanvasSize();
  return fitScale < 1;
}

function renderCanvas() {
  const layer = byId("node-layer");
  layer.querySelectorAll(".node,.empty").forEach((element) => element.remove());
  const nodes = state?.nodes || [];
  byId("download-png").disabled = nodes.length === 0;
  if (nodes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = "<div><strong>Architecture data is not available</strong>The view updates when the task reports architecture changes.</div>";
    layer.append(empty);
    renderEdges();
    return;
  }
  positionNodes(nodes);
  for (const node of nodes) {
    const element = createNode(node);
    const position = positions.get(node.id);
    element.style.transform = `translate3d(${position.x}px,${position.y}px,0)`;
    layer.append(element);
  }
  renderEdges();
}

function renderAgents() {
  const list = byId("agents");
  list.replaceChildren();
  const agents = state?.agents || [];
  if (!agents.length) {
    const empty = document.createElement("div");
    empty.className = "agent-activity";
    empty.textContent = "No agent activity has arrived.";
    list.append(empty);
  }
  for (const agent of agents) {
    const row = document.createElement("article");
    row.className = "agent";
    const name = document.createElement("div");
    name.className = "agent-name";
    name.textContent = `${agent.name} · ${agent.status}`;
    const activity = document.createElement("div");
    activity.className = "agent-activity";
    activity.textContent = agent.activity;
    row.append(name, activity);
    list.append(row);
  }
}

function renderEvents() {
  const list = byId("events");
  list.replaceChildren();
  for (const event of state?.events || []) {
    const row = document.createElement("article");
    row.className = "event";
    const mark = document.createElement("div");
    mark.className = "event-mark";
    const content = document.createElement("div");
    const label = document.createElement("div");
    label.className = "event-label";
    label.textContent = event.label;
    const meta = document.createElement("div");
    meta.className = "event-meta";
    meta.textContent = `${event.type} · ${event.status}`;
    content.append(label, meta);
    row.append(mark, content);
    list.append(row);
  }
}

function renderConversation() {
  const list = byId("conversation");
  list.replaceChildren();
  for (const entry of state?.conversation || []) {
    const message = document.createElement("div");
    message.className = `message ${entry.role}`;
    message.textContent = entry.text;
    list.append(message);
  }
  list.scrollTop = list.scrollHeight;
}

function renderTaskSelect() {
  const select = byId("task-select");
  const selected = state?.thread?.id || select.value;
  select.replaceChildren();
  for (const task of tasks) {
    const option = document.createElement("option");
    option.value = task.id;
    option.textContent = `${task.name} · ${task.status}`;
    select.append(option);
  }
  if (selected && !tasks.some((task) => task.id === selected)) {
    const option = document.createElement("option");
    option.value = selected;
    option.textContent = state?.thread?.name || selected;
    select.prepend(option);
  }
  if (selected) select.value = selected;
}

function render() {
  if (!state) return;
  if (state.thread.id !== positionTaskId) loadPositions(state.thread.id);
  byId("task-name").textContent = state.thread.name;
  byId("task-state").textContent = state.thread.status;
  byId("node-count").textContent = `${state.nodes.length} nodes`;
  byId("agent-count").textContent = `${state.agents.length} agents`;
  byId("link-count").textContent = `${state.relationships.length} links`;
  byId("revision").textContent = `r${state.revision}`;
  byId("agent-summary").textContent = `${state.agents.length} live`;
  byId("event-count").textContent = state.events.length;
  renderTaskSelect();
  canvasRenderGate.requestRender();
  renderAgents();
  renderEvents();
  renderConversation();
}

async function call(name, args = {}) {
  if (standalone) {
    if (name === "list_codex_tasks") {
      const response = await fetch("/api/tasks");
      if (!response.ok) throw new Error("Could not list Codex tasks");
      return response.json();
    }
    if (name === "get_architecture_state") {
      const query = args.threadId ? `?threadId=${encodeURIComponent(args.threadId)}` : "";
      const response = await fetch(`/api/state${query}`);
      if (!response.ok) throw new Error("Could not read architecture state");
      return response.json();
    }
    if (name === "message_codex_task") {
      const response = await fetch("/api/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!response.ok) throw new Error("Could not message the Codex task");
      return response.json();
    }
  }
  const result = await ui.callServerTool({ name, arguments: args });
  if (result?.isError) throw new Error(result.content?.[0]?.text || `${name} failed`);
  return structured(result);
}

async function loadTasks() {
  const result = await call("list_codex_tasks");
  tasks = result?.tasks || [];
  renderTaskSelect();
}

async function refresh(threadId = state?.thread?.id) {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await call("get_architecture_state", threadId ? { threadId } : {});
    if (next?.thread) {
      state = next;
      render();
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Refresh failed");
  } finally {
    refreshing = false;
  }
}

function connectEventStream(threadId) {
  if (!standalone || !threadId) return;
  eventSource?.close();
  eventSource = new EventSource(`/api/events?threadId=${encodeURIComponent(threadId)}`);
  eventSource.addEventListener("state", (event) => {
    const next = JSON.parse(event.data);
    if (next?.thread) {
      state = next;
      render();
    }
  });
  eventSource.addEventListener("error", () => showToast("The live connection will retry."));
}

ui.ontoolresult = (result) => {
  const initial = structured(result);
  if (initial?.thread) {
    state = initial;
    render();
  }
};
byId("copy-reopen-link").addEventListener("click", async () => {
  try {
    if (!state?.thread?.id) throw new Error("Select a task first.");
    const url = standalone
      ? `${location.origin}/?thread=${encodeURIComponent(state.thread.id)}`
      : (await call("open_architecture_view", { threadId: state.thread.id })).viewerUrl;
    const field = byId("reopen-link");
    field.value = url;
    field.hidden = false;
    field.focus();
    field.select();
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied. Use it to reopen this task while the service is running.");
    } catch {
      showToast("Copy the selected link to reopen this task.");
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not get the reopen link.");
  }
});
byId("refresh").addEventListener("click", () => refresh());
byId("fit").addEventListener("click", () => {
  const fitted = fitNodes();
  byId("canvas").scrollTo({ top: 0, left: 0, behavior: "smooth" });
  showToast(fitted ? "Nodes fitted to viewport" : "Nodes are already fitted");
});
for (const [id, factor] of [["zoom-in", 1.2], ["zoom-out", 1 / 1.2]]) {
  byId(id).addEventListener("click", () => {
    const canvas = byId("canvas");
    zoomAt(factor, canvas.clientWidth / 2, canvas.clientHeight / 2);
  });
}
byId("canvas").addEventListener("wheel", (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const rect = byId("canvas").getBoundingClientRect();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
  zoomAt(Math.exp(-delta * 0.01), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
let exporting = false;
byId("download-png").addEventListener("click", async () => {
  if (exporting) return;
  exporting = true;
  const button = byId("download-png");
  button.textContent = "Preparing PNG…";
  try {
    await downloadNodesPng(byId("node-layer"), state?.thread?.name || "architecture");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "PNG export failed");
  } finally {
    exporting = false;
    button.textContent = "Download nodes PNG";
  }
});
byId("task-select").addEventListener("change", async (event) => {
  const threadId = event.currentTarget.value;
  fitScale = 1;
  updateCanvasSize();
  byId("canvas").scrollTo(0, 0);
  await refresh(threadId);
  connectEventStream(threadId);
  if (standalone) history.replaceState(null, "", `?thread=${encodeURIComponent(threadId)}`);
});
byId("message-trigger").addEventListener("click", () => { byId("dock").hidden = false; byId("message").focus(); });
byId("close").addEventListener("click", () => { byId("dock").hidden = true; });
byId("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const field = byId("message");
  const message = field.value.trim();
  if (!message || !state?.thread?.id) return;
  field.disabled = true;
  try {
    await call("message_codex_task", { threadId: state.thread.id, message });
    field.value = "";
    showToast("Guidance sent to the task");
    window.setTimeout(() => refresh(), 500);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Message failed");
  } finally {
    field.disabled = false;
    field.focus();
  }
});

async function start() {
  if (!standalone) await ui.connect();
  await loadTasks().catch(() => undefined);
  const requestedThread = standalone ? new URLSearchParams(location.search).get("thread") : null;
  if (!state) await refresh(requestedThread || undefined);
  if (standalone) connectEventStream(state?.thread?.id);
  else refreshTimer = window.setInterval(() => refresh(), 1800);
  window.addEventListener("pagehide", () => {
    window.clearInterval(refreshTimer);
    eventSource?.close();
  });
}

start().catch((error) => showToast(error instanceof Error ? error.message : "Architecture View could not start"));

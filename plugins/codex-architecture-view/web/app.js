import { downloadNodesPng } from "./node-export.js";
import { zoomViewport } from "./zoom.js";
import { App } from "@modelcontextprotocol/ext-apps";
import { createCanvasRenderGate, draggedPosition } from "./drag-state.js";
import { layoutArchitecture, visibleArchitecture } from "./semantic-layout.js";

const ui = new App({ name: "codex-architecture-view", version: "0.1.0" }, {}, { autoResize: true });
const byId = (id) => document.getElementById(id);
const positions = new Map();
const pins = new Map();
const collapsedNodes = new Set();
let positionTaskId = null;
let nodeLayouts = {};
let visibleGraph = { visibleNodes: [], visibleRelationships: [] };
let layoutSignature = "";
let layoutTimer = null;
let layoutRun = 0;
let selectedNodeId = null;
let selectedRelationshipIds = [];
let lastSelectedNode = null;
let lastInspectorSelectionKey = "";
let state = null;
let tasks = [];
let refreshTimer = null;
let refreshing = false;
let eventSource = null;
let fitScale = 1;
const standalone = window.parent === window;
const canvasRenderGate = createCanvasRenderGate(() => renderCanvas());

function workspaceStorageKey(threadId) {
  return `codex-architecture-view:workspace:${threadId}`;
}

function loadPositions(threadId) {
  positions.clear();
  pins.clear();
  collapsedNodes.clear();
  nodeLayouts = {};
  layoutSignature = "";
  selectedNodeId = null;
  selectedRelationshipIds = [];
  lastSelectedNode = null;
  positionTaskId = threadId || null;
  if (!positionTaskId) return;
  try {
    const stored = JSON.parse(window.localStorage.getItem(workspaceStorageKey(positionTaskId)) || "null");
    if (stored?.version !== 2) {
      const childrenByParent = new Map();
      for (const node of state?.nodes || []) if (node.parentId) childrenByParent.set(node.parentId, [...(childrenByParent.get(node.parentId) || []), node]);
      for (const [parentId, children] of childrenByParent) {
        if (children.length && children.every(({ nodeKind }) => nodeKind === "endpoint" || nodeKind === "mapping")) collapsedNodes.add(parentId);
      }
      return;
    }
    for (const [nodeId, value] of Object.entries(stored.pins || {})) {
      if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
        const position = { x: Math.max(0, value.x), y: Math.max(0, value.y) };
        pins.set(nodeId, position);
        positions.set(nodeId, position);
      }
    }
    for (const nodeId of stored.collapsedNodes || []) if (typeof nodeId === "string") collapsedNodes.add(nodeId);
  } catch {
    // Storage can be unavailable in a restricted Codex panel.
  }
}

function saveWorkspace() {
  if (!positionTaskId) return;
  try {
    window.localStorage.setItem(workspaceStorageKey(positionTaskId), JSON.stringify({
      version: 2,
      pins: Object.fromEntries(pins),
      collapsedNodes: [...collapsedNodes],
    }));
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
  let row = 0;
  for (const node of nodes) {
    if (!positions.has(node.id)) positions.set(node.id, { x: 34, y: 26 + row * 150 });
    row += 1;
  }
}

function currentLayoutInput() {
  return Object.fromEntries([...positions].map(([id, value]) => [id, value]));
}

function structuralSignature() {
  return JSON.stringify({
    nodes: visibleGraph.visibleNodes.map(({ id, parentId, nodeKind }) => [id, parentId, nodeKind]),
    relationships: visibleGraph.visibleRelationships.map(({ from, to, kind }) => [from, to, kind]),
  });
}

function requestLayout({ force = false, reset = false } = {}) {
  const signature = structuralSignature();
  if (!force && signature === layoutSignature) return;
  layoutSignature = signature;
  window.clearTimeout(layoutTimer);
  const run = ++layoutRun;
  layoutTimer = window.setTimeout(async () => {
    try {
      const layout = await layoutArchitecture(
        visibleGraph.visibleNodes,
        visibleGraph.visibleRelationships,
        reset ? {} : currentLayoutInput(),
        Object.fromEntries(pins),
      );
      if (run !== layoutRun) return;
      nodeLayouts = layout;
      for (const [nodeId, value] of Object.entries(layout)) positions.set(nodeId, { x: value.x, y: value.y });
      byId("layout-warning").hidden = true;
      renderCanvas();
    } catch {
      if (run !== layoutRun) return;
      byId("layout-warning").hidden = false;
    }
  }, force ? 0 : 300);
}

function descendantIds(nodeId) {
  return Object.entries(nodeLayouts).flatMap(([candidateId, layout]) => {
    const visited = new Set([candidateId]);
    let parentId = layout.parentId;
    while (parentId && !visited.has(parentId)) {
      if (parentId === nodeId) return [candidateId];
      visited.add(parentId);
      parentId = nodeLayouts[parentId]?.parentId || null;
    }
    return [];
  });
}

function selectNode(node) {
  selectedNodeId = node.id;
  selectedRelationshipIds = [];
  lastSelectedNode = node;
  renderArchitectureDetails();
  renderCanvas();
}

function createNode(node) {
  const element = document.createElement("article");
  element.className = "node";
  element.dataset.nodeId = node.id;
  element.dataset.status = statusClass(node.status);
  element.dataset.selected = String(selectedNodeId === node.id);
  element.dataset.pinned = String(pins.has(node.id));
  element.dataset.unmapped = String(Boolean(nodeLayouts[node.id]?.unmapped));
  const hasChildren = visibleGraph.visibleNodes.some(({ parentId }) => parentId === node.id);
  element.dataset.container = String(hasChildren);
  element.tabIndex = 0;
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", `${node.name}${selectedNodeId === node.id ? ", selected" : ""}${nodeLayouts[node.id]?.unmapped ? ", unmapped" : ""}. Press Enter for details.`);
  const kind = document.createElement("div");
  kind.className = "node-kind";
  kind.textContent = nodeLayouts[node.id]?.unmapped ? "unmapped" : node.nodeKind || "module";
  const title = document.createElement("div");
  title.className = "node-title";
  title.textContent = node.name;
  if ((state?.nodes || []).some(({ parentId }) => parentId === node.id)) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "node-toggle";
    toggle.setAttribute("aria-label", `${collapsedNodes.has(node.id) ? "Expand" : "Collapse"} ${node.name}`);
    toggle.textContent = collapsedNodes.has(node.id) ? "+" : "−";
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (collapsedNodes.has(node.id)) collapsedNodes.delete(node.id); else collapsedNodes.add(node.id);
      saveWorkspace();
      renderCanvas();
    });
    title.prepend(toggle);
  }
  if (pins.has(node.id)) {
    const unpin = document.createElement("button");
    unpin.type = "button";
    unpin.className = "node-unpin";
    unpin.setAttribute("aria-label", `Unpin ${node.name}`);
    unpin.textContent = "Unpin";
    unpin.addEventListener("click", (event) => {
      event.stopPropagation();
      pins.delete(node.id);
      saveWorkspace();
      requestLayout({ force: true });
    });
    title.append(unpin);
  }
  const role = document.createElement("div");
  role.className = "node-role";
  role.textContent = node.role;
  element.append(kind, title, role);
  const childNodes = (state?.nodes || []).filter(({ parentId }) => parentId === node.id);
  if (collapsedNodes.has(node.id) && childNodes.length) {
    const grouped = document.createElement("div");
    grouped.className = "node-children";
    grouped.setAttribute("aria-label", `Grouped nodes: ${childNodes.map(({ name }) => name).join(", ")}`);
    grouped.textContent = `Grouped: ${childNodes.map(({ name }) => name).join(" · ")}`;
    element.append(grouped);
  }
  let frame = 0;
  let drag = null;
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag || event.target.closest("button")) return;
    event.preventDefault();
    const current = positions.get(node.id);
    const descendants = Object.fromEntries(descendantIds(node.id).map((id) => [id, positions.get(id)]));
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: current.x, y: current.y, moved: false, descendants };
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
    drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8;
    positions.set(node.id, next);
    const delta = { x: next.x - drag.x, y: next.y - drag.y };
    for (const [id, origin] of Object.entries(drag.descendants)) {
      const childPosition = { x: origin.x + delta.x, y: origin.y + delta.y };
      positions.set(id, childPosition);
      const child = byId("node-layer").querySelector(`[data-node-id="${CSS.escape(id)}"]`);
      if (child) child.style.transform = `translate3d(${childPosition.x}px,${childPosition.y}px,0)`;
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      element.style.transform = `translate3d(${next.x}px,${next.y}px,0)`;
      renderEdges();
    });
  });
  const stop = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    drag = null;
    element.classList.remove("dragging");
    if (moved) {
      pins.set(node.id, positions.get(node.id));
      saveWorkspace();
      element.dataset.pinned = "true";
    } else selectNode(node);
    canvasRenderGate.stopDrag();
  };
  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);
  element.addEventListener("lostpointercapture", stop);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectNode(node);
    }
  });
  return element;
}

function nodeLayerBounds() {
  const currentIds = new Set(visibleGraph.visibleNodes.map((node) => node.id));
  const currentPositions = [...positions.entries()]
    .filter(([nodeId]) => currentIds.has(nodeId))
    .map(([nodeId, value]) => ({ ...value, width: nodeLayouts[nodeId]?.width || 220, height: nodeLayouts[nodeId]?.height || 160 }));
  return {
    maxX: Math.max(760, ...currentPositions.map((value) => value.x + value.width + 40)),
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
  for (const relation of visibleGraph.visibleRelationships) {
    const from = positions.get(relation.from);
    const to = positions.get(relation.to);
    if (!from || !to) continue;
    const fromLayout = nodeLayouts[relation.from];
    const toLayout = nodeLayouts[relation.to];
    const x1 = from.x + (fromLayout?.width || 220);
    const y1 = from.y + Math.min(66, (fromLayout?.height || 112) / 2);
    const x2 = to.x;
    const y2 = to.y + Math.min(66, (toLayout?.height || 112) / 2);
    const bend = Math.max(50, Math.abs(x2 - x1) * .45);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "edge");
    path.dataset.relationshipId = relation.id;
    path.setAttribute("role", "button");
    path.setAttribute("tabindex", "0");
    path.setAttribute("aria-label", `${relation.label}: ${relation.from} to ${relation.to}`);
    if (relation.relationshipIds.some((id) => selectedRelationshipIds.includes(id))) path.classList.add("selected");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "edge-label");
    label.setAttribute("x", String((x1 + x2) / 2));
    label.setAttribute("y", String((y1 + y2) / 2 - 7));
    label.setAttribute("text-anchor", "middle");
    label.textContent = relation.label || relation.kind;
    const select = () => {
      selectedNodeId = null;
      selectedRelationshipIds = relation.relationshipIds;
      renderArchitectureDetails();
      renderCanvas();
    };
    path.addEventListener("click", select);
    path.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
    });
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
  visibleGraph = visibleArchitecture(nodes, state?.relationships || [], collapsedNodes);
  positionNodes(visibleGraph.visibleNodes);
  const orderedNodes = [...visibleGraph.visibleNodes].sort((left, right) => {
    const depth = (node) => {
      const visited = new Set([node.id]);
      let parentId = node.parentId;
      let value = 0;
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId); value += 1;
        parentId = nodes.find(({ id }) => id === parentId)?.parentId || null;
      }
      return value;
    };
    return depth(left) - depth(right);
  });
  for (const node of orderedNodes) {
    const element = createNode(node);
    const position = positions.get(node.id);
    const layout = nodeLayouts[node.id];
    element.style.width = `${layout?.width || 220}px`;
    element.style.height = `${layout?.height || 132}px`;
    element.style.transform = `translate3d(${position.x}px,${position.y}px,0)`;
    layer.append(element);
  }
  renderEdges();
  requestLayout();
}

function detailList(title, items) {
  const section = document.createElement("section");
  section.className = "detail-group";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  if (!items.length) {
    const empty = document.createElement("p");
    empty.textContent = `No ${title.toLowerCase()} reported.`;
    section.append(empty);
    return section;
  }
  const list = document.createElement("ul");
  for (const item of items) {
    const row = document.createElement("li");
    row.textContent = item;
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderArchitectureDetails() {
  const container = byId("architecture-details");
  container.replaceChildren();
  const currentNode = (state?.nodes || []).find(({ id }) => id === selectedNodeId);
  if (currentNode) lastSelectedNode = currentNode;
  const removedNode = selectedNodeId && !currentNode && lastSelectedNode?.id === selectedNodeId ? lastSelectedNode : null;
  const node = currentNode || removedNode;
  const relationships = (state?.relationships || []).filter(({ id }) => selectedRelationshipIds.includes(id));
  const hasSelection = Boolean(node || relationships.length);
  byId("architecture-name").textContent = node?.name || (relationships.length ? `${relationships.length} relationships` : "Whole system");

  if (hasSelection) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "detail-close";
    close.setAttribute("aria-label", "Close architecture details");
    close.textContent = "×";
    close.addEventListener("click", () => {
      selectedNodeId = null;
      selectedRelationshipIds = [];
      renderArchitectureDetails();
      renderCanvas();
    });
    container.append(close);
  }

  if (removedNode) {
    const notice = document.createElement("p");
    notice.className = "detail-warning";
    notice.textContent = "This node was removed. These are its last known details.";
    container.append(notice);
  }

  if (node) {
    const role = document.createElement("p");
    role.className = "detail-role";
    role.textContent = node.role;
    const facts = document.createElement("dl");
    const nodeById = new Map((state?.nodes || []).map((item) => [item.id, item]));
    for (const [label, value] of [
      ["Type", node.nodeKind || "module"], ["Status", node.status], ["Verification", node.verification || "unverified"],
      ["Parent", nodeById.get(node.parentId)?.name || "Workspace root"],
    ]) {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      row.append(term, detail);
      facts.append(row);
    }
    const children = (state?.nodes || []).filter(({ parentId }) => parentId === node.id);
    const linked = (state?.relationships || []).filter(({ from, to }) => from === node.id || to === node.id);
    container.append(
      role,
      facts,
      detailList("Child nodes", children.map(({ name, nodeKind }) => `${name} · ${nodeKind || "module"}`)),
      detailList("Relationships", linked.map((relation) => {
        const outgoing = relation.from === node.id;
        const otherId = outgoing ? relation.to : relation.from;
        return `${outgoing ? "To" : "From"} ${nodeById.get(otherId)?.name || otherId} · ${relation.label || relation.kind}`;
      })),
      detailList("Affected files", node.affectedFiles || []),
      detailList("Evidence", node.evidence || []),
    );
  } else if (relationships.length) {
    const nodeById = new Map((state?.nodes || []).map((item) => [item.id, item]));
    container.append(detailList("Underlying relationships", relationships.map((relation) =>
      `${nodeById.get(relation.from)?.name || relation.from} → ${nodeById.get(relation.to)?.name || relation.to} · ${relation.label || relation.kind}`,
    )));
  }

  const selectionKey = node ? `node:${node.id}` : relationships.length ? `relationships:${selectedRelationshipIds.join(",")}` : "";
  if (selectionKey !== lastInspectorSelectionKey) {
    byId("agents-section").open = !hasSelection;
    byId("event-section").open = !hasSelection;
    lastInspectorSelectionKey = selectionKey;
  }
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
    name.textContent = agent.name;
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
    meta.textContent = event.type;
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
    option.textContent = task.name;
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
  renderArchitectureDetails();
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
  byId("canvas").scrollTo({ top: 0, left: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  showToast(fitted ? "Nodes fitted to viewport" : "Nodes are already fitted");
});
byId("arrange").addEventListener("click", () => {
  layoutSignature = "";
  requestLayout({ force: true });
  showToast("Architecture layout recalculated");
});
byId("reset-layout").addEventListener("click", () => {
  pins.clear();
  positions.clear();
  nodeLayouts = {};
  saveWorkspace();
  layoutSignature = "";
  renderCanvas();
  requestLayout({ force: true, reset: true });
  showToast("Pins cleared and layout reset");
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
byId("canvas").addEventListener("pointerdown", (event) => {
  if (event.target !== byId("canvas") && event.target !== byId("canvas-size") && event.target !== byId("node-layer")) return;
  selectedNodeId = null;
  selectedRelationshipIds = [];
  renderArchitectureDetails();
  renderCanvas();
});
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

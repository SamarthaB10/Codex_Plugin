import ELK from "elkjs/lib/elk.bundled.js";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 132;
const UNMAPPED_GAP = 42;

function validParentId(node, byId) {
  if (!node.parentId || !byId.has(node.parentId)) return null;
  const visited = new Set([node.id]);
  let parentId = node.parentId;
  while (parentId) {
    if (visited.has(parentId)) return null;
    visited.add(parentId);
    parentId = byId.get(parentId)?.parentId || null;
  }
  return node.parentId;
}

function visibleAnchor(nodeId, visibleIds, byId) {
  const visited = new Set();
  let current = nodeId;
  while (current && !visited.has(current)) {
    if (visibleIds.has(current)) return current;
    visited.add(current);
    current = byId.get(current)?.parentId || null;
  }
  return null;
}

export function visibleArchitecture(nodes, relationships, collapsedIds) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const isVisible = (node) => {
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId && !visited.has(parentId)) {
      if (collapsedIds.has(parentId)) return false;
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId || null;
    }
    return true;
  };
  const visibleNodes = nodes.filter(isVisible);
  const visibleIds = new Set(visibleNodes.map(({ id }) => id));
  const groups = new Map();
  for (const relationship of relationships) {
    const from = visibleAnchor(relationship.from, visibleIds, byId);
    const to = visibleAnchor(relationship.to, visibleIds, byId);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}\u0000${relationship.kind || "relationship"}`;
    const group = groups.get(key) || { from, to, kind: relationship.kind, items: [] };
    group.items.push(relationship);
    groups.set(key, group);
  }
  const visibleRelationships = [...groups.values()].map((group) => ({
    id: `visible:${group.from}:${group.to}:${group.kind || "relationship"}`,
    from: group.from,
    to: group.to,
    kind: group.kind,
    label: group.items.length > 1
      ? `${group.items.length} ${group.kind || "relationships"}`
      : group.items[0].label || group.kind || "relationship",
    verification: group.items.some(({ verification }) => verification === "failed")
      ? "failed"
      : group.items.every(({ verification }) => verification === "verified") ? "verified" : "unverified",
    relationshipIds: group.items.map(({ id }) => id),
  }));
  return { visibleNodes, visibleRelationships };
}

function elkNode(node, childrenByParent, previous) {
  const children = childrenByParent.get(node.id) || [];
  return {
    id: node.id,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    ...(previous[node.id] || {}),
    ...(children.length ? {
      children: children.map((child) => elkNode(child, childrenByParent, previous)),
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.padding": "[top=138,left=28,bottom=28,right=28]",
        "elk.spacing.nodeNode": "42",
      },
    } : {}),
  };
}

function flatten(node, offsetX, offsetY, parentId, output) {
  for (const child of node.children || []) {
    const x = offsetX + (child.x || 0);
    const y = offsetY + (child.y || 0);
    output[child.id] = {
      x,
      y,
      width: child.width || NODE_WIDTH,
      height: child.height || NODE_HEIGHT,
      parentId,
      unmapped: false,
    };
    flatten(child, x, y, child.id, output);
  }
}

export async function layoutArchitecture(nodes, relationships, previous = {}, pins = {}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const connected = new Set(relationships.flatMap(({ from, to }) => [from, to]));
  const unmappedIds = new Set(nodes.filter((node) =>
    !validParentId(node, byId)
      && node.parentId !== "task"
      && node.nodeKind !== "system"
      && !connected.has(node.id),
  ).map(({ id }) => id));
  for (const node of nodes) {
    let parentId = validParentId(node, byId);
    const visited = new Set([node.id]);
    while (parentId && !visited.has(parentId)) {
      if (unmappedIds.has(parentId)) unmappedIds.add(node.id);
      visited.add(parentId);
      parentId = validParentId(byId.get(parentId), byId);
    }
  }

  const mapped = nodes.filter(({ id }) => !unmappedIds.has(id));
  const childrenByParent = new Map();
  const roots = [];
  for (const node of mapped) {
    const parentId = validParentId(node, byId);
    if (parentId && !unmappedIds.has(parentId)) {
      childrenByParent.set(parentId, [...(childrenByParent.get(parentId) || []), node]);
    } else roots.push(node);
  }
  const graph = {
    id: "workspace-root",
    children: roots.map((node) => elkNode(node, childrenByParent, previous)),
    edges: relationships.filter(({ from, to }) => !unmappedIds.has(from) && !unmappedIds.has(to)).map(({ id, from, to }) => ({ id, sources: [from], targets: [to] })),
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.interactiveLayout": "true",
      "elk.layered.crossingMinimization.semiInteractive": "true",
      "elk.layered.spacing.nodeNodeBetweenLayers": "86",
      "elk.spacing.nodeNode": "58",
    },
  };
  const laidOut = await new ELK().layout(graph);
  const output = {};
  flatten(laidOut, 0, 0, null, output);
  const mappedRight = Math.max(0, ...Object.values(output).filter(({ parentId }) => !parentId).map(({ x, width }) => x + width));
  let unmappedY = 0;
  for (const node of nodes.filter(({ id }) => unmappedIds.has(id))) {
    output[node.id] = { x: mappedRight + 150, y: unmappedY, width: NODE_WIDTH, height: NODE_HEIGHT, parentId: null, unmapped: true };
    unmappedY += NODE_HEIGHT + UNMAPPED_GAP;
  }
  const pinDepth = ([nodeId]) => {
    let depth = 0;
    let parentId = output[nodeId]?.parentId;
    while (parentId && output[parentId]) {
      depth += 1;
      parentId = output[parentId].parentId;
    }
    return depth;
  };
  const isDescendant = (candidateId, ancestorId) => {
    let parentId = output[candidateId]?.parentId;
    while (parentId) {
      if (parentId === ancestorId) return true;
      parentId = output[parentId]?.parentId || null;
    }
    return false;
  };
  for (const [nodeId, position] of Object.entries(pins).sort((a, b) => pinDepth(a) - pinDepth(b))) {
    if (!output[nodeId]) continue;
    const dx = position.x - output[nodeId].x;
    const dy = position.y - output[nodeId].y;
    for (const [candidateId, candidate] of Object.entries(output)) {
      if (candidateId === nodeId || isDescendant(candidateId, nodeId)) {
        output[candidateId] = { ...candidate, x: candidate.x + dx, y: candidate.y + dy };
      }
    }
  }
  return output;
}

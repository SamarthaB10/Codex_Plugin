import test from "node:test";
import assert from "node:assert/strict";
import { layoutArchitecture, visibleArchitecture } from "../web/semantic-layout.js";

test("lays children inside containers and separates unmapped nodes", async () => {
  const nodes = [
    { id: "system", nodeKind: "system" },
    { id: "api", nodeKind: "service", parentId: "system" },
    { id: "unknown", nodeKind: "component" },
  ];
  const layout = await layoutArchitecture(nodes, []);
  assert.equal(layout.api.parentId, "system");
  assert.equal(layout.unknown.unmapped, true);
  assert.equal(layout.system.unmapped, false);
});

test("keeps pinned positions and lays cycles", async () => {
  const nodes = [{ id: "one", nodeKind: "service" }, { id: "two", nodeKind: "service" }];
  const relationships = [
    { id: "one-two", from: "one", to: "two", kind: "calls" },
    { id: "two-one", from: "two", to: "one", kind: "calls" },
  ];
  const layout = await layoutArchitecture(nodes, relationships, {}, { one: { x: 12, y: 24 } });
  assert.deepEqual({ x: layout.one.x, y: layout.one.y }, { x: 12, y: 24 });
  assert.equal(layout.two.unmapped, false);
});

test("treats the hidden task parent as the workspace root", async () => {
  const layout = await layoutArchitecture([
    { id: "service", nodeKind: "service", parentId: "task" },
  ], []);
  assert.equal(layout.service.parentId, null);
  assert.equal(layout.service.unmapped, false);
});

test("moves descendants with a pinned container", async () => {
  const nodes = [
    { id: "system", nodeKind: "system" },
    { id: "service", nodeKind: "service", parentId: "system" },
  ];
  const initial = await layoutArchitecture(nodes, []);
  const pinned = await layoutArchitecture(nodes, [], initial, {
    system: { x: initial.system.x + 100, y: initial.system.y + 80 },
  });
  assert.equal(pinned.service.x, initial.service.x + 100);
  assert.equal(pinned.service.y, initial.service.y + 80);
});

test("keeps separate top-level systems connected", async () => {
  const nodes = [
    { id: "commerce", nodeKind: "system" },
    { id: "billing", nodeKind: "system" },
  ];
  const layout = await layoutArchitecture(nodes, [
    { id: "platform-link", from: "commerce", to: "billing", kind: "depends-on" },
  ]);
  assert.equal(layout.commerce.unmapped, false);
  assert.equal(layout.billing.unmapped, false);
  assert.notEqual(layout.commerce.x, layout.billing.x);
});

test("aggregates hidden relationships at a collapsed parent", () => {
  const nodes = [
    { id: "system", nodeKind: "system" },
    { id: "one", nodeKind: "component", parentId: "system" },
    { id: "two", nodeKind: "component", parentId: "system" },
    { id: "store", nodeKind: "store" },
  ];
  const relationships = [
    { id: "one-store", from: "one", to: "store", kind: "reads-from" },
    { id: "two-store", from: "two", to: "store", kind: "reads-from" },
  ];
  const result = visibleArchitecture(nodes, relationships, new Set(["system"]));
  assert.deepEqual(result.visibleRelationships[0].relationshipIds, ["one-store", "two-store"]);
  assert.equal(result.visibleRelationships[0].label, "2 reads-from");
});

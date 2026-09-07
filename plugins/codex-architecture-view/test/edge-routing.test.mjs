import test from "node:test";
import assert from "node:assert/strict";

import { boxesOverlap, routeEdge } from "../web/edge-routing.js";

const box = (x, y, width = 220, height = 132) => ({ x, y, width, height });

test("routes a reverse edge around an unrelated node", () => {
  const obstacle = box(310, 368);
  const route = routeEdge({
    source: box(650, 345),
    target: box(70, 368),
    obstacles: [obstacle],
    occupiedLabels: [],
    label: "Reports result",
    index: 0,
  });

  assert.equal(route.samples.some((point) => boxesOverlap(
    { x: point.x - 3, y: point.y - 3, width: 6, height: 6 },
    obstacle,
    8,
  )), false);
});

test("keeps relationship labels apart", () => {
  const first = routeEdge({
    source: box(70, 368),
    target: box(650, 345),
    obstacles: [box(310, 368)],
    occupiedLabels: [],
    label: "Delivers order",
    index: 0,
  });
  const second = routeEdge({
    source: box(70, 368),
    target: box(650, 345),
    obstacles: [box(310, 368)],
    occupiedLabels: [first.labelBox],
    label: "Reports result",
    index: 1,
  });

  assert.equal(boxesOverlap(first.labelBox, second.labelBox, 8), false);
});

test("does not overshoot the gap between adjacent nodes", () => {
  const source = box(70, 368);
  const target = box(310, 368);
  const route = routeEdge({
    source,
    target,
    obstacles: [],
    labelObstacles: [source, target],
    occupiedLabels: [],
    label: "Queues order",
    index: 0,
  });

  assert.ok(route.controls.every(({ x }) => x >= route.start.x && x <= route.end.x));
  assert.equal(boxesOverlap(route.labelBox, source, 8), false);
  assert.equal(boxesOverlap(route.labelBox, target, 8), false);
});

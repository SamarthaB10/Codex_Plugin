import test from "node:test";
import assert from "node:assert/strict";
import { zoomViewport } from "../web/zoom.js";

test("zoom preserves the graph point under the pointer after scrolling", () => {
  assert.deepEqual(zoomViewport(0.5, 2, 100, 200, 50, 80), { scale: 1, left: 250, top: 480 });
});

test("zoom limits do not move the viewport when already at a limit", () => {
  assert.deepEqual(zoomViewport(3, 2, 100, 200, 50, 80), { scale: 3, left: 100, top: 200 });
  assert.deepEqual(zoomViewport(0.05, 0.5, 0, 0, 50, 80), { scale: 0.05, left: 0, top: 0 });
});

test("zoom out does not enlarge a large map after fit sets a scale below the zoom limit", () => {
  assert.deepEqual(zoomViewport(0.04, 1 / 1.2, 0, 0, 50, 80), { scale: 0.04, left: 0, top: 0 });
});

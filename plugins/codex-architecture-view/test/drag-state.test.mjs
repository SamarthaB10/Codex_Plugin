import test from "node:test";
import assert from "node:assert/strict";
import { createCanvasRenderGate, draggedPosition } from "../web/drag-state.js";

test("keeps a drag active through a live render and flushes once on release", () => {
  let renderCount = 0;
  const gate = createCanvasRenderGate(() => { renderCount += 1; });

  gate.startDrag();
  assert.equal(gate.requestRender(), false);
  assert.deepEqual(
    draggedPosition({ x: 34, y: 26 }, { x: 100, y: 100 }, { x: 160, y: 140 }, 0.5),
    { x: 154, y: 106 },
  );
  assert.equal(renderCount, 0);

  gate.stopDrag();
  assert.equal(renderCount, 1);
});

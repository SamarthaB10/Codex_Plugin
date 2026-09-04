export function draggedPosition(origin, start, current, scale = 1) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: Math.max(0, origin.x + (current.x - start.x) / safeScale),
    y: Math.max(0, origin.y + (current.y - start.y) / safeScale),
  };
}

export function createCanvasRenderGate(renderCanvas) {
  let activeDrags = 0;
  let renderPending = false;

  return {
    startDrag() {
      activeDrags += 1;
    },
    requestRender() {
      if (activeDrags > 0) {
        renderPending = true;
        return false;
      }
      renderCanvas();
      return true;
    },
    stopDrag() {
      activeDrags = Math.max(0, activeDrags - 1);
      if (activeDrags === 0 && renderPending) {
        renderPending = false;
        renderCanvas();
      }
    },
  };
}

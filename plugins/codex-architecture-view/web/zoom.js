// Keep the graph point below the pointer fixed while the scale changes.
export function zoomViewport(scale, factor, left, top, x, y) {
  const next = Math.min(3, Math.max(Math.min(0.05, scale), scale * factor));
  return {
    scale: next,
    left: Math.max(0, (left + x) * next / scale - x),
    top: Math.max(0, (top + y) * next / scale - y),
  };
}

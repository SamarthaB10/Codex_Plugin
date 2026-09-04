import { toBlob } from "html-to-image";

export async function downloadNodesPng(layer, name) {
  const nodes = [...layer.querySelectorAll(".node")];
  if (!nodes.length) throw new Error("There are no nodes to download.");
  // Read layout coordinates, independent of viewport zoom and scrolling.
  const boxes = nodes.map((node) => {
    const transform = new DOMMatrixReadOnly(node.style.transform);
    return { x: transform.m41, y: transform.m42, width: node.offsetWidth, height: node.offsetHeight };
  });
  const padding = 24;
  const left = Math.min(...boxes.map((box) => box.x)) - padding;
  const top = Math.min(...boxes.map((box) => box.y)) - padding;
  const width = Math.ceil(Math.max(...boxes.map((box) => box.x + box.width)) - left + padding);
  const height = Math.ceil(Math.max(...boxes.map((box) => box.y + box.height)) - top + padding);
  // Bound memory use for large maps while retaining the complete layout.
  const pixelRatio = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16000000 / (width * height)));
  const snapshot = document.createElement("div");
  Object.assign(snapshot.style, { position: "fixed", left: "0", top: "0", zIndex: "-1", width: `${width}px`, height: `${height}px`, background: "#030303" });
  nodes.forEach((node, index) => {
    const clone = node.cloneNode(true);
    clone.classList.remove("dragging");
    clone.style.transform = `translate(${boxes[index].x - left}px, ${boxes[index].y - top}px)`;
    snapshot.append(clone);
  });
  document.body.append(snapshot);
  try {
    const blob = await toBlob(snapshot, { width, height, pixelRatio, skipFonts: true, style: { position: "relative", left: "0", top: "0", zIndex: "0" } });
    if (!blob) throw new Error("Could not create the PNG image.");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "architecture"}-nodes.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    snapshot.remove();
  }
}

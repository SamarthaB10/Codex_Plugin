const LABEL_HEIGHT = 18;
const LABEL_CHARACTER_WIDTH = 6.8;

export function boxesOverlap(left, right, padding = 0) {
  return left.x < right.x + right.width + padding
    && left.x + left.width + padding > right.x
    && left.y < right.y + right.height + padding
    && left.y + left.height + padding > right.y;
}

function pointToward(from, to, distance) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!length) return { ...from };
  const scale = Math.min(distance, length / 2) / length;
  return { x: from.x + (to.x - from.x) * scale, y: from.y + (to.y - from.y) * scale };
}

function roundedPath(points, radius = 12) {
  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const before = pointToward(current, points[index - 1], radius);
    const after = pointToward(current, points[index + 1], radius);
    commands.push(`L ${before.x} ${before.y}`, `Q ${current.x} ${current.y} ${after.x} ${after.y}`);
  }
  commands.push(`L ${points.at(-1).x} ${points.at(-1).y}`);
  return commands.join(" ");
}

function samplePolyline(points) {
  const samples = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const count = Math.max(2, Math.ceil(length / 12));
    for (let step = 0; step < count; step += 1) {
      const progress = step / count;
      samples.push({ x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress });
    }
  }
  samples.push(points.at(-1));
  return samples;
}

function labelBox(label, point) {
  const width = Math.max(42, label.length * LABEL_CHARACTER_WIDTH + 14);
  return {
    x: point.x - width / 2,
    y: point.y - LABEL_HEIGHT / 2,
    width,
    height: LABEL_HEIGHT,
  };
}

function routePorts(source, target) {
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const direction = targetCenter.x >= sourceCenter.x ? 1 : -1;
  return {
    direction,
    start: { x: direction > 0 ? source.x + source.width : source.x, y: sourceCenter.y },
    end: { x: direction > 0 ? target.x : target.x + target.width, y: targetCenter.y },
  };
}

function candidateOffsets(index) {
  const sign = index % 2 === 0 ? -1 : 1;
  return [0, 48, -48, 92, -92, 148, -148, 212, -212, 284, -284, 360, -360]
    .map((offset) => offset * sign);
}

export function routeEdge({ source, target, obstacles = [], labelObstacles = obstacles, occupiedLabels = [], label = "Relationship", index = 0 }) {
  const { direction, start, end } = routePorts(source, target);
  const stub = Math.min(8, Math.abs(end.x - start.x) / 3);
  let best = null;

  for (const offset of candidateOffsets(index)) {
    const corridorY = (start.y + end.y) / 2 + offset;
    const first = { x: start.x + direction * stub, y: start.y };
    const second = { x: first.x, y: corridorY };
    const fourth = { x: end.x - direction * stub, y: end.y };
    const third = { x: fourth.x, y: corridorY };
    const points = [start, first, second, third, fourth, end];
    const samples = samplePolyline(points);
    const labelPoint = { x: (second.x + third.x) / 2, y: corridorY };
    const currentLabelBox = labelBox(label, labelPoint);
    const pathHits = samples.slice(2, -2).filter((point) => obstacles.some((obstacle) => boxesOverlap(
      { x: point.x - 3, y: point.y - 3, width: 6, height: 6 },
      obstacle,
      8,
    ))).length;
    const labelHits = labelObstacles.filter((obstacle) => boxesOverlap(currentLabelBox, obstacle, 10)).length
      + occupiedLabels.filter((occupied) => boxesOverlap(currentLabelBox, occupied, 8)).length;
    const outOfBounds = samples.some((point) => point.x < 8 || point.y < 8) ? 1 : 0;
    const score = pathHits * 1000 + labelHits * 1000 + outOfBounds * 500 + Math.abs(offset);
    const candidate = {
      start,
      end,
      controls: [first, second, third, fourth],
      samples,
      labelBox: currentLabelBox,
      label: labelPoint,
      path: roundedPath(points),
      score,
    };
    if (!best || candidate.score < best.score) best = candidate;
    if (score === Math.abs(offset)) return candidate;
  }

  return best;
}

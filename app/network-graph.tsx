'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

const CANONICAL_ROOT_SLUG = 'openclaw-template';

type GraphNode = {
  id: string;
  label: string;
  section: 'soul';
  kind: string;
  slug: string;
  href: string;
  tx: number;
  ty: number;
  pinned: boolean;
  degree: number;
  orbitRadius: number;
  orbitPhase: number;
  orbitSpeed: number;
  // Physics state
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type GraphEdge = {
  source: string;
  target: string;
  type: 'fork' | 'connection';
};

type DragState = {
  nodeId: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type Props = {
  nodes: {
    id: string;
    label: string;
    section: 'soul';
    kind: string;
    slug: string;
  }[];
  edges: {
    source: string;
    target: string;
    type: 'fork' | 'connection';
  }[];
};

const COLORS = {
  soul: '#22d3ee',
  memory: '#f59e0b',
  fork: '#a78bfa',
  connection: '#2a2d40',
  bg: '#08090d',
  grid: '#0f1117',
  gridLine: '#141720',
  text: '#e2e4eb',
  muted: '#6b7080',
};

const NODE_RADIUS = 8;
const HOVER_RADIUS = 12;
const LABEL_ALWAYS_THRESHOLD = 8;
const DRAG_THRESHOLD = 4;

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function rgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function baseNodeRadius(node: Pick<GraphNode, 'pinned' | 'degree'>) {
  return node.pinned ? NODE_RADIUS * 2.1 : NODE_RADIUS + Math.min(node.degree, 4) * 0.55;
}

function buildTargetLayout(
  nodes: Props['nodes'],
  edges: Props['edges'],
  width: number,
  height: number
) {
  const cx = width / 2;
  const cy = height / 2;
  const rootId = nodes.find((node) => node.slug === CANONICAL_ROOT_SLUG)?.id || nodes[0]?.id || '';
  const depthMap = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();

  for (const node of nodes) {
    outgoing.set(node.id, []);
    incomingCount.set(node.id, 0);
  }

  for (const edge of edges) {
    const list = outgoing.get(edge.source);
    if (list) list.push(edge.target);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1);
  }

  if (rootId) {
    depthMap.set(rootId, 0);
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDepth = depthMap.get(current) || 0;
      const children = outgoing.get(current) || [];
      for (const child of children) {
        if (depthMap.has(child)) continue;
        depthMap.set(child, currentDepth + 1);
        queue.push(child);
      }
    }
  }

  const rootCandidates = nodes
    .filter((node) => !depthMap.has(node.id))
    .sort((a, b) => {
      const incomingDelta = (incomingCount.get(a.id) || 0) - (incomingCount.get(b.id) || 0);
      if (incomingDelta !== 0) return incomingDelta;
      return a.slug.localeCompare(b.slug);
    });

  let fallbackDepth = 1;
  for (const node of rootCandidates) {
    depthMap.set(node.id, fallbackDepth);
    fallbackDepth += 1;
  }

  const layers = new Map<number, Props['nodes']>();
  for (const node of nodes) {
    const depth = depthMap.get(node.id) || 0;
    const layer = layers.get(depth) || [];
    layer.push(node);
    layers.set(depth, layer);
  }

  const layout = new Map<string, { x: number; y: number; pinned: boolean }>();
  const maxRadius = Math.min(width, height) * 0.42;

  for (const [depth, layer] of layers.entries()) {
    if (depth === 0) {
      for (const node of layer) {
        layout.set(node.id, { x: cx, y: cy, pinned: node.id === rootId });
      }
      continue;
    }

    const sorted = [...layer].sort((a, b) => {
      const aHash = hashString(a.id);
      const bHash = hashString(b.id);
      if (aHash !== bHash) return aHash - bHash;
      return a.slug.localeCompare(b.slug);
    });

    const radius = Math.min(maxRadius, 78 + depth * 62);
    const step = (Math.PI * 2) / Math.max(sorted.length, 1);

    sorted.forEach((node, index) => {
      const jitter = ((hashString(`${node.id}:angle`) % 1000) / 1000 - 0.5) * 0.18;
      const radialOffset = ((hashString(`${node.id}:radius`) % 1000) / 1000 - 0.5) * 18;
      const angle = -Math.PI / 2 + index * step + jitter;
      layout.set(node.id, {
        x: cx + Math.cos(angle) * (radius + radialOffset),
        y: cy + Math.sin(angle) * (radius + radialOffset * 0.7),
        pinned: false
      });
    });
  }

  return layout;
}

export default function NetworkGraph({ nodes: inputNodes, edges: inputEdges }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const hoveredRef = useRef<GraphNode | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const mouseRef = useRef<{ x: number; y: number }>({ x: -1000, y: -1000 });
  const sizeRef = useRef<{ w: number; h: number }>({ w: 800, h: 400 });
  const router = useRouter();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string; section: string } | null>(null);
  const [layoutSize, setLayoutSize] = useState<{ w: number; h: number }>({ w: 800, h: 400 });

  const findNodeAt = useCallback((x: number, y: number) => {
    let closest: GraphNode | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const node of nodesRef.current) {
      const radius = Math.max(HOVER_RADIUS, baseNodeRadius(node) + 3);
      const dx = node.x - x;
      const dy = node.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius && distance < closestDistance) {
        closest = node;
        closestDistance = distance;
      }
    }

    return closest;
  }, []);

  const setTooltipForNode = useCallback((node: GraphNode | null, x: number, y: number) => {
    if (!node) {
      setTooltip(null);
      return;
    }

    setTooltip({
      x,
      y,
      text: node.label,
      section: node.section,
    });
  }, []);

  const canvasPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      rect,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  useEffect(() => {
    const layout = buildTargetLayout(inputNodes, inputEdges, layoutSize.w, layoutSize.h);
    const degreeMap = new Map<string, number>();
    for (const edge of inputEdges) {
      degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + 1);
      degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + 1);
    }

    nodesRef.current = inputNodes.map((n) => {
      const target = layout.get(n.id) || { x: layoutSize.w / 2, y: layoutSize.h / 2, pinned: false };
      const seed = hashString(n.id);
      return {
        ...n,
        href: `/${n.section}/${n.slug}`,
        tx: target.x,
        ty: target.y,
        pinned: target.pinned,
        degree: degreeMap.get(n.id) || 0,
        orbitRadius: target.pinned ? 0 : 3 + (seed % 5),
        orbitPhase: ((seed % 360) * Math.PI) / 180,
        orbitSpeed: 0.45 + (((seed >> 3) % 1000) / 1000) * 0.55,
        x: target.x,
        y: target.y,
        vx: 0,
        vy: 0
      };
    });

    edgesRef.current = inputEdges;
  }, [inputNodes, inputEdges, layoutSize]);

  const simulate = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const w = sizeRef.current.w;
    const h = sizeRef.current.h;
    const cx = w / 2;
    const cy = h / 2;

    if (nodes.length === 0) return;

    const damping = 0.86;
    const repulsion = 900;
    const attraction = 0.016;
    const tether = 0.026;
    const time = Date.now() / 1000;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const idealDist = edge.type === 'connection' ? 120 : 88;
      const force = (dist - idealDist) * attraction;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    for (const node of nodes) {
      if (dragRef.current?.nodeId === node.id) {
        node.x = node.tx;
        node.y = node.ty;
        node.vx = 0;
        node.vy = 0;
        continue;
      }

      if (node.pinned) {
        node.x = node.tx;
        node.y = node.ty;
        node.vx = 0;
        node.vy = 0;
        continue;
      }

      const desiredX = node.tx + Math.cos(time * node.orbitSpeed + node.orbitPhase) * node.orbitRadius;
      const desiredY =
        node.ty +
        Math.sin(time * node.orbitSpeed * 0.82 + node.orbitPhase * 1.4) *
          (node.orbitRadius * 0.78);

      node.vx += (desiredX - node.x) * tether;
      node.vy += (desiredY - node.y) * tether;
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;

      const pad = 30;
      if (node.x < pad) { node.x = pad; node.vx = Math.abs(node.vx) * 0.5; }
      if (node.x > w - pad) { node.x = w - pad; node.vx = -Math.abs(node.vx) * 0.5; }
      if (node.y < pad) { node.y = pad; node.vy = Math.abs(node.vy) * 0.5; }
      if (node.y > h - pad) { node.y = h - pad; node.vy = -Math.abs(node.vy) * 0.5; }
    }
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const w = canvas.width;
    const h = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const time = Date.now() / 1000;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = dpr * 0.5;
    const gridSize = 40 * dpr;
    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const mx = mouseRef.current.x * dpr;
    const my = mouseRef.current.y * dpr;

    let hovered: GraphNode | null = null;
    const hoverDist = HOVER_RADIUS * dpr * 2;
    for (const node of nodes) {
      const nx = node.x * dpr;
      const ny = node.y * dpr;
      const dist = Math.sqrt((nx - mx) ** 2 + (ny - my) ** 2);
      if (dist < hoverDist) {
        hovered = node;
        break;
      }
    }
    hoveredRef.current = hovered;

    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      const sx = source.x * dpr;
      const sy = source.y * dpr;
      const tx = target.x * dpr;
      const ty = target.y * dpr;

      const isHighlighted = hovered && (edge.source === hovered.id || edge.target === hovered.id);

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);

      if (edge.type === 'fork') {
        ctx.strokeStyle = isHighlighted ? COLORS.fork : rgba(COLORS.fork, 0.2);
        ctx.lineWidth = isHighlighted ? 2 * dpr : 1 * dpr;
      } else if (edge.type === 'connection') {
        ctx.strokeStyle = isHighlighted ? COLORS.soul : rgba(COLORS.soul, 0.16);
        ctx.lineWidth = isHighlighted ? 1.8 * dpr : 0.9 * dpr;
      }

      if (!isHighlighted) {
        ctx.setLineDash(edge.type === 'connection' ? [8 * dpr, 8 * dpr] : [4 * dpr, 4 * dpr]);
        ctx.lineDashOffset = -(time * (edge.type === 'connection' ? 16 : 28)) * dpr;
      } else {
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }

      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      const pulseCount = isHighlighted ? 2 : 1;
      for (let index = 0; index < pulseCount; index++) {
        const seed = hashString(`${edge.source}:${edge.target}:${index}`);
        const offset = (seed % 1000) / 1000;
        const speed = edge.type === 'connection' ? 0.11 : edge.type === 'fork' ? 0.17 : 0.13;
        const t = (time * speed + offset) % 1;
        const px = sx + (tx - sx) * t;
        const py = sy + (ty - sy) * t;
        ctx.beginPath();
        ctx.arc(px, py, (isHighlighted ? 2.6 : 1.7) * dpr, 0, Math.PI * 2);
        ctx.fillStyle = edge.type === 'fork'
          ? (isHighlighted ? COLORS.fork : rgba(COLORS.fork, 0.55))
          : (isHighlighted ? COLORS.soul : rgba(COLORS.soul, 0.45));
        ctx.fill();
      }
    }

    for (const node of nodes) {
      const nx = node.x * dpr;
      const ny = node.y * dpr;
      const isHovered = hovered === node;
      const isConnected = hovered && edges.some(
        (e) => (e.source === hovered.id && e.target === node.id) || (e.target === hovered.id && e.source === node.id)
      );
      const color = node.section === 'soul' ? COLORS.soul : COLORS.memory;
      const baseRadius = baseNodeRadius(node);
      const radius = (isHovered ? Math.max(HOVER_RADIUS, baseRadius + 2) : baseRadius) * dpr;
      const pulseRadius = node.pinned ? (1 + Math.sin(time * 2.2) * 0.08) : 1;

      if (isHovered || isConnected) {
        const gradient = ctx.createRadialGradient(nx, ny, 0, nx, ny, radius * 3);
        gradient.addColorStop(0, color + '40');
        gradient.addColorStop(1, color + '00');
        ctx.beginPath();
        ctx.arc(nx, ny, radius * 3, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(nx, ny, radius * pulseRadius, 0, Math.PI * 2);

      if (node.pinned) {
        ctx.fillStyle = isHovered ? '#7dd3fc' : 'rgba(34, 211, 238, 0.9)';
        ctx.strokeStyle = '#7dd3fc';
      } else if (node.kind === 'fork') {
        ctx.fillStyle = isHovered ? COLORS.fork : 'rgba(167, 139, 250, 0.7)';
        ctx.strokeStyle = COLORS.fork;
      } else {
        ctx.fillStyle = isHovered ? color : color + 'AA';
        ctx.strokeStyle = color;
      }

      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();

      if (node.pinned) {
        const halo = ctx.createRadialGradient(nx, ny, 0, nx, ny, radius * 4.5);
        halo.addColorStop(0, rgba(COLORS.soul, 0.2));
        halo.addColorStop(1, rgba(COLORS.soul, 0));
        ctx.beginPath();
        ctx.arc(nx, ny, radius * 4.5, 0, Math.PI * 2);
        ctx.fillStyle = halo;
        ctx.fill();
      }

      if (node.kind === 'core' || node.kind === 'canonical') {
        ctx.beginPath();
        ctx.arc(nx, ny, radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.bg;
        ctx.fill();
      }

      const alwaysShowLabels = nodes.length < LABEL_ALWAYS_THRESHOLD || node.pinned;
      if (isHovered || alwaysShowLabels) {
        ctx.font = `${(isHovered ? 13 : 11) * dpr}px "JetBrains Mono", "Fira Code", monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = isHovered || node.pinned ? COLORS.text : COLORS.muted;
        ctx.fillText(node.label, nx, ny - radius - 8 * dpr);
      }
    }
  }, []);

  useEffect(() => {
    const loop = () => {
      simulate();
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [simulate, draw]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width;
      const h = 400;
      sizeRef.current = { w, h };
      setLayoutSize((current) => (current.w === w && current.h === h ? current : { w, h }));
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const point = canvasPoint(event);
    if (!canvas || !point) return;

    mouseRef.current = { x: point.x, y: point.y };

    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const nextX = Math.max(30, Math.min(sizeRef.current.w - 30, point.x - drag.offsetX));
      const nextY = Math.max(30, Math.min(sizeRef.current.h - 30, point.y - drag.offsetY));
      const node = nodesRef.current.find((candidate) => candidate.id === drag.nodeId) || null;

      if (node) {
        node.tx = nextX;
        node.ty = nextY;
        node.x = nextX;
        node.y = nextY;
        node.vx = 0;
        node.vy = 0;
      }

      if (!drag.moved) {
        const dx = point.x - drag.startX;
        const dy = point.y - drag.startY;
        if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) {
          drag.moved = true;
          suppressClickRef.current = true;
        }
      }

      canvas.style.cursor = 'grabbing';
      hoveredRef.current = node;
      setTooltipForNode(node, point.x, point.y);
      return;
    }

    const hovered = findNodeAt(point.x, point.y);
    hoveredRef.current = hovered;
    canvas.style.cursor = hovered ? 'grab' : 'default';
    setTooltipForNode(hovered, point.x, point.y);
  }, [canvasPoint, findNodeAt, setTooltipForNode]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const point = canvasPoint(event);
    if (!canvas || !point) return;

    const node = findNodeAt(point.x, point.y);
    hoveredRef.current = node;
    mouseRef.current = { x: point.x, y: point.y };

    if (!node) {
      canvas.style.cursor = 'default';
      setTooltip(null);
      return;
    }

    dragRef.current = {
      nodeId: node.id,
      pointerId: event.pointerId,
      offsetX: point.x - node.x,
      offsetY: point.y - node.y,
      startX: point.x,
      startY: point.y,
      moved: false
    };
    suppressClickRef.current = false;
    canvas.style.cursor = 'grabbing';
    setTooltipForNode(node, point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  }, [canvasPoint, findNodeAt, setTooltipForNode]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const point = canvasPoint(event);
    if (!canvas) return;

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    const drag = dragRef.current;
    dragRef.current = null;

    if (!point) {
      canvas.style.cursor = 'default';
      setTooltip(null);
      return;
    }

    mouseRef.current = { x: point.x, y: point.y };
    const hovered = findNodeAt(point.x, point.y);
    hoveredRef.current = hovered;
    canvas.style.cursor = hovered ? 'grab' : 'default';
    setTooltipForNode(hovered, point.x, point.y);

    if (drag?.moved) {
      suppressClickRef.current = true;
    }
  }, [canvasPoint, findNodeAt, setTooltipForNode]);

  const handlePointerLeave = useCallback(() => {
    if (dragRef.current) return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = 'default';
    }
    mouseRef.current = { x: -1000, y: -1000 };
    hoveredRef.current = null;
    setTooltip(null);
  }, []);

  const handleClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const hovered = hoveredRef.current;
    if (hovered) {
      router.push(hovered.href);
    }
  }, [router]);

  return (
    <div className="network-graph-container" ref={containerRef}>
      <canvas
        ref={canvasRef}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
      />
      {tooltip && (
        <div
          className="graph-tooltip"
          style={{
            left: tooltip.x,
            top: tooltip.y - 16,
          }}
        >
          <span style={{ color: tooltip.section === 'soul' ? COLORS.soul : COLORS.memory }}>
            {tooltip.section.toUpperCase()}
          </span>
          {' / '}
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

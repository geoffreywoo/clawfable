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
  // Physics state
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type GraphEdge = {
  source: string;
  target: string;
  type: 'fork' | 'revision' | 'connection';
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
    type: 'fork' | 'revision' | 'connection';
  }[];
};

const COLORS = {
  soul: '#22d3ee',
  memory: '#f59e0b',
  fork: '#a78bfa',
  revision: '#3d4150',
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

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
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
  const mouseRef = useRef<{ x: number; y: number }>({ x: -1000, y: -1000 });
  const sizeRef = useRef<{ w: number; h: number }>({ w: 800, h: 400 });
  const router = useRouter();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string; section: string } | null>(null);
  const [layoutSize, setLayoutSize] = useState<{ w: number; h: number }>({ w: 800, h: 400 });

  useEffect(() => {
    const layout = buildTargetLayout(inputNodes, inputEdges, layoutSize.w, layoutSize.h);
    const degreeMap = new Map<string, number>();
    for (const edge of inputEdges) {
      degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + 1);
      degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + 1);
    }

    nodesRef.current = inputNodes.map((n) => {
      const target = layout.get(n.id) || { x: layoutSize.w / 2, y: layoutSize.h / 2, pinned: false };
      return {
        ...n,
        href: `/${n.section}/${n.slug}`,
        tx: target.x,
        ty: target.y,
        pinned: target.pinned,
        degree: degreeMap.get(n.id) || 0,
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
      if (node.pinned) {
        node.x = node.tx;
        node.y = node.ty;
        node.vx = 0;
        node.vy = 0;
        continue;
      }

      node.vx += (node.tx - node.x) * tether;
      node.vy += (node.ty - node.y) * tether;
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
        ctx.strokeStyle = isHighlighted ? COLORS.fork : 'rgba(167, 139, 250, 0.2)';
        ctx.lineWidth = isHighlighted ? 2 * dpr : 1 * dpr;
      } else {
        ctx.strokeStyle = isHighlighted ? COLORS.muted : 'rgba(61, 65, 80, 0.3)';
        ctx.lineWidth = isHighlighted ? 1.5 * dpr : 0.5 * dpr;
      }

      if (!isHighlighted) {
        ctx.setLineDash([4 * dpr, 4 * dpr]);
      } else {
        ctx.setLineDash([]);
      }

      ctx.stroke();
      ctx.setLineDash([]);

      if (isHighlighted) {
        const t = (Date.now() % 2000) / 2000;
        const px = sx + (tx - sx) * t;
        const py = sy + (ty - sy) * t;
        ctx.beginPath();
        ctx.arc(px, py, 2 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = edge.type === 'fork' ? COLORS.fork : COLORS.soul;
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
      const baseRadius = node.pinned ? NODE_RADIUS * 2.1 : NODE_RADIUS + Math.min(node.degree, 4) * 0.55;
      const radius = (isHovered ? Math.max(HOVER_RADIUS, baseRadius + 2) : baseRadius) * dpr;

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
      ctx.arc(nx, ny, radius, 0, Math.PI * 2);

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

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    mouseRef.current = { x, y };

    const hovered = hoveredRef.current;
    if (hovered) {
      canvas.style.cursor = 'pointer';
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        text: hovered.label,
        section: hovered.section,
      });
    } else {
      canvas.style.cursor = 'default';
      setTooltip(null);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = { x: -1000, y: -1000 };
    setTooltip(null);
  }, []);

  const handleClick = useCallback(() => {
    const hovered = hoveredRef.current;
    if (hovered) {
      router.push(hovered.href);
    }
  }, [router]);

  return (
    <div className="network-graph-container" ref={containerRef}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
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

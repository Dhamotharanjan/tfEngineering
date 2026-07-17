import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import {
  formatNodeTypeLabel,
  nodeIconSize,
  normalizeType,
  resolveNodeVisual,
} from './graphNodeVisuals';

const EDGE_COLORS = {
  REFERENCES_MODULE: '#a855f7',
  USES_MODULE: '#a855f7',
  CONSUMED_BY: '#60a5fa',
  DEPENDS_ON: '#94a3b8',
  REFERENCES: '#64748b',
  DEPLOYS: '#4ade80',
  HAS_STACK: '#4ade80',
  MANAGES: '#fb923c',
  PUBLISHES: '#60a5fa',
  HAS_FINDING: '#f87171',
  CONTAINS_MODULE: '#c084fc',
  PROVIDED_BY: '#38bdf8',
  IN_VPC: '#7B3FF2',
  IN_SUBNET: '#8C4FFF',
  USES_SG: '#DD344C',
  ATTACHED_TO: '#ED7100',
  ROUTES_VIA: '#06b6d4',
  USES_ROUTE_TABLE: '#22d3ee',
  ALLOWS_CIDR: '#eab308',
  INGRESS_FROM_SG: '#f87171',
  EGRESS_TO_SG: '#fb923c',
  DATA_PATH: '#22c55e',
  HAS_CIDR: '#ca8a04',
  default: '#475569',
};

const SLICE_LEGEND = {
  component: 'Resource-level dependencies within a repo',
  lineage: 'Upstream ↔ downstream repos and their AWS resources',
  repo: 'Upstream and downstream repository relationships',
  manifest: 'Manifest version and module pin graph',
  architecture: 'Pattern architecture — ingress/egress with ports and protocols',
};

function edgeDisplayLabel(e) {
  if (e.label) return String(e.label);
  const portProto =
    e.port || e.protocol ? `${e.port || '?'}/${e.protocol || '?'}` : '';
  if (e.direction === 'ingress' || e.direction === 'egress') {
    return `${String(e.direction).toUpperCase()}${portProto ? ` ${portProto}` : ''}`.trim();
  }
  if (portProto) return `${e.type || 'EDGE'} ${portProto}`.trim();
  return e.type || '';
}

function edgeLabelWidth(text) {
  return Math.max(String(text).length * 6.2 + 16, 40);
}

function GraphNodeIcon({ visual, size }) {
  const { Icon, icon } = visual;
  return (
    <div
      xmlns="http://www.w3.org/1999/xhtml"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: icon || '#ffffff',
      }}
    >
      <Icon size={size} strokeWidth={2.25} />
    </div>
  );
}

function nodeRadius(type) {
  const t = normalizeType(type);
  if (t === 'repository') return 26;
  if (t === 'module') return 22;
  if (t === 'stack') return 20;
  if (t === 'cloudresource') return 18;
  return 16;
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function buildNeighborSet(selectedId, edges) {
  const neighbors = new Set([selectedId]);
  for (const e of edges) {
    if (e.from === selectedId) neighbors.add(e.to);
    if (e.to === selectedId) neighbors.add(e.from);
  }
  return neighbors;
}

function formatTooltip(node) {
  const visual = resolveNodeVisual(node);
  const lines = [node.label, `Type: ${formatNodeTypeLabel(node)}`];
  if (visual.awsType) lines.push(`Resource: ${visual.awsType}`);
  if (visual.role === 'module_source') lines.push('Role: module source');
  if (visual.role === 'downstream_consumer') lines.push('Role: downstream consumer');
  if (node.detail && node.detail !== node.label) lines.push(`Detail: ${node.detail}`);
  if (node.provider) lines.push(`Provider: ${node.provider}`);
  if (node.stack_id) lines.push(`Stack: ${node.stack_id}`);
  if (node.pci) lines.push('PCI scope');
  if (node.severity) lines.push(`Severity: ${node.severity}`);
  return lines;
}

function graphSignature(nodes, edges) {
  const nodeIds = nodes.map((n) => n.id).join('|');
  const edgeIds = edges.map((e) => `${e.from}>${e.to}:${e.type}`).join('|');
  return `${nodeIds}::${edgeIds}`;
}

export default function DependencyGraph({
  nodes: propNodes = [],
  edges: propEdges = [],
  selectedNodeId = null,
  onNodeClick,
  slice = 'component',
  height = 520,
}) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const zoomLayerRef = useRef(null);
  const simulationRef = useRef(null);
  const simNodesRef = useRef([]);
  const transformRef = useRef(zoomIdentity);

  const [layoutNodes, setLayoutNodes] = useState([]);
  const [dimensions, setDimensions] = useState({ width: 800, height });
  const [transform, setTransform] = useState(zoomIdentity);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [draggingId, setDraggingId] = useState(null);
  const dragMovedRef = useRef(false);

  const graphKey = useMemo(
    () => graphSignature(propNodes, propEdges),
    [propNodes, propEdges],
  );

  const neighbors = useMemo(
    () => (selectedNodeId ? buildNeighborSet(selectedNodeId, propEdges) : null),
    [selectedNodeId, propEdges],
  );

  const activeNodeTypes = useMemo(() => {
    const seen = new Map();
    for (const n of propNodes) {
      const visual = resolveNodeVisual(n);
      const key = visual.awsType || `${normalizeType(n.type)}:${visual.role || ''}`;
      if (!seen.has(key)) {
        seen.set(key, { visual, node: n });
      }
    }
    return [...seen.values()];
  }, [propNodes]);

  const activeEdgeTypes = useMemo(() => {
    const types = new Set(propEdges.map((e) => e.type || 'RELATES_TO'));
    return [...types].sort();
  }, [propEdges]);

  const nodeMap = useMemo(
    () => Object.fromEntries(layoutNodes.map((n) => [n.id, n])),
    [layoutNodes],
  );

  const showLabels = transform.k >= 0.65;
  const showEdgeLabels = slice === 'architecture' ? transform.k >= 0.45 : transform.k >= 0.85;

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect;
      if (width > 0) setDimensions({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [height]);

  useEffect(() => {
    const svg = select(svgRef.current);
    if (!svg.node()) return undefined;

    const zoomBehavior = zoom()
      .scaleExtent([0.15, 4])
      .filter((event) => {
        if (draggingId) return false;
        return !event.ctrlKey && !event.button;
      })
      .on('zoom', (event) => {
        setTransform(event.transform);
      });

    svg.call(zoomBehavior);
    svg.on('dblclick.zoom', null);

    return () => {
      svg.on('.zoom', null);
    };
  }, [dimensions.width, height, draggingId]);

  useEffect(() => {
    if (!propNodes.length) {
      simNodesRef.current = [];
      setLayoutNodes([]);
      simulationRef.current?.stop();
      return undefined;
    }

    const simNodes = propNodes.map((n) => ({
      ...n,
      x: n.x ?? Math.random() * 80 - 40,
      y: n.y ?? Math.random() * 80 - 40,
      r: nodeRadius(n.type),
    }));
    const nodeIndex = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks = propEdges
      .map((e) => {
        const source = nodeIndex.get(e.from);
        const target = nodeIndex.get(e.to);
        if (!source || !target) return null;
        return { ...e, source, target };
      })
      .filter(Boolean);

    simNodesRef.current = simNodes;
    const { width } = dimensions;

    const simulation = forceSimulation(simNodes)
      .force(
        'link',
        forceLink(simLinks)
          .id((d) => d.id)
          .distance((link) => {
            const sr = link.source.r || 18;
            const tr = link.target.r || 18;
            return sr + tr + 56;
          })
          .strength(0.65),
      )
      .force('charge', forceManyBody().strength(-320).distanceMax(420))
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collide',
        forceCollide()
          .radius((d) => (d.r || 18) + 10)
          .strength(0.85),
      )
      .alpha(1)
      .alphaDecay(0.028)
      .velocityDecay(0.35);

    let frame = 0;
    simulation.on('tick', () => {
      frame += 1;
      if (frame % 2 === 0) {
        setLayoutNodes(simNodes.map((n) => ({ ...n })));
      }
    });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [graphKey, dimensions.width, height]);

  const screenToGraph = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = zoomLayerRef.current?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inverted = ctm.inverse();
    const graphPt = pt.matrixTransform(inverted);
    return { x: graphPt.x, y: graphPt.y };
  }, []);

  const handleNodePointerDown = useCallback((event, node) => {
    event.stopPropagation();
    dragMovedRef.current = false;
    setDraggingId(node.id);
    const simNode = simNodesRef.current.find((n) => n.id === node.id);
    if (!simNode) return;
    simNode.fx = simNode.x;
    simNode.fy = simNode.y;
    simulationRef.current?.alphaTarget(0.3).restart();
  }, []);

  useEffect(() => {
    if (!draggingId) return undefined;

    const handleMove = (event) => {
      dragMovedRef.current = true;
      const simNode = simNodesRef.current.find((n) => n.id === draggingId);
      if (!simNode) return;
      const { x, y } = screenToGraph(event.clientX, event.clientY);
      simNode.fx = x;
      simNode.fy = y;
    };

    const handleUp = () => {
      const simNode = simNodesRef.current.find((n) => n.id === draggingId);
      if (simNode) {
        simNode.fx = null;
        simNode.fy = null;
      }
      simulationRef.current?.alphaTarget(0);
      setDraggingId(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [draggingId, screenToGraph]);

  const handleNodeMouseMove = useCallback((event, node) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPos({
      x: event.clientX - rect.left + 12,
      y: event.clientY - rect.top + 12,
    });
    setHoveredNode(node);
  }, []);

  const handleCanvasPointerDown = useCallback((event) => {
    if (event.target === svgRef.current || event.target === zoomLayerRef.current) {
      setHoveredNode(null);
    }
  }, []);

  if (!propNodes.length) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-brand-500/5 to-transparent text-sm text-slate-500"
        style={{ height }}
      >
        No graph nodes for this slice
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-brand-500/5 to-transparent"
      style={{ height }}
      onPointerDown={handleCanvasPointerDown}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className={draggingId ? 'cursor-grabbing' : 'cursor-grab'}
        style={{ touchAction: 'none' }}
      >
        <defs>
          <marker
            id="graph-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="#64748b" />
          </marker>
          <marker
            id="graph-arrow-active"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="#22d3ee" />
          </marker>
        </defs>

        <rect width="100%" height="100%" fill="transparent" />

        <g ref={zoomLayerRef} transform={transform.toString()}>
          <g className="graph-edges">
            {propEdges.map((e, i) => {
              const from = nodeMap[e.from];
              const to = nodeMap[e.to];
              if (from?.x == null || to?.x == null) return null;

              const connected =
                selectedNodeId && (e.from === selectedNodeId || e.to === selectedNodeId);
              const dimmed = selectedNodeId && !connected;
              const edgeColor =
                e.direction === 'ingress'
                  ? '#f87171'
                  : e.direction === 'egress'
                    ? '#fb923c'
                    : EDGE_COLORS[e.type] || EDGE_COLORS.default;
              const labelText = edgeDisplayLabel(e);
              const labelW = edgeLabelWidth(labelText);

              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const dist = Math.hypot(dx, dy) || 1;
              const fr = from.r || 18;
              const tr = to.r || 18;
              const x1 = from.x + (dx / dist) * fr;
              const y1 = from.y + (dy / dist) * fr;
              const x2 = to.x - (dx / dist) * (tr + 6);
              const y2 = to.y - (dy / dist) * (tr + 6);
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;

              return (
                <g key={`${e.from}-${e.to}-${e.type}-${e.port || ''}-${i}`} opacity={dimmed ? 0.2 : 1}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={connected ? '#22d3ee' : edgeColor}
                    strokeWidth={connected ? 2.5 : e.port ? 2 : 1.5}
                    strokeOpacity={connected ? 1 : 0.75}
                    markerEnd={connected ? 'url(#graph-arrow-active)' : 'url(#graph-arrow)'}
                  />
                  {showEdgeLabels && labelText && (
                    <g transform={`translate(${mx}, ${my})`}>
                      <rect
                        x={-(labelW / 2)}
                        y={-9}
                        width={labelW}
                        height={16}
                        rx={4}
                        fill="#0b1220"
                        fillOpacity={0.88}
                        stroke={connected ? '#22d3ee' : '#334155'}
                        strokeWidth={1}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={connected ? '#67e8f9' : '#94a3b8'}
                        fontSize={9}
                        fontWeight="600"
                        fontFamily="JetBrains Mono, ui-monospace, monospace"
                      >
                        {labelText}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          <g className="graph-nodes">
            {layoutNodes.map((n) => {
              const type = normalizeType(n.type);
              const visual = resolveNodeVisual(n);
              const colors = { fill: visual.fill, stroke: visual.stroke };
              const r = n.r || nodeRadius(n.type);
              const iconSize = nodeIconSize(n.type);
              const isSelected = n.id === selectedNodeId;
              const isNeighbor = neighbors?.has(n.id) && !isSelected;
              const dimmed = selectedNodeId && !neighbors?.has(n.id);
              const isHovered = hoveredNode?.id === n.id;
              const isDragging = draggingId === n.id;
              const clickable = Boolean(onNodeClick);
              const labelText = truncate(n.label, showLabels ? 22 : 0);

              return (
                <g
                  key={n.id}
                  className="graph-node"
                  transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
                  style={{
                    cursor: isDragging ? 'grabbing' : clickable ? 'pointer' : 'grab',
                    opacity: dimmed ? 0.3 : 1,
                  }}
                  onPointerDown={(ev) => handleNodePointerDown(ev, n)}
                  onClick={(ev) => {
                    if (dragMovedRef.current) return;
                    ev.stopPropagation();
                    onNodeClick?.(n);
                  }}
                  onMouseEnter={(ev) => handleNodeMouseMove(ev, n)}
                  onMouseMove={(ev) => handleNodeMouseMove(ev, n)}
                  onMouseLeave={() => setHoveredNode(null)}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={(ev) => {
                    if (clickable && (ev.key === 'Enter' || ev.key === ' ')) {
                      ev.preventDefault();
                      onNodeClick?.(n);
                    }
                  }}
                >
                  {(isSelected || isNeighbor) && (
                    <circle
                      r={r + 8}
                      fill="none"
                      stroke={isSelected ? '#22d3ee' : '#60a5fa'}
                      strokeWidth={isSelected ? 3 : 2}
                      strokeOpacity={0.55}
                    />
                  )}
                  <circle
                    r={r}
                    fill={colors.fill}
                    fillOpacity={isSelected ? 0.98 : isNeighbor ? 0.9 : 0.82}
                    stroke={isHovered || isSelected ? '#e2e8f0' : colors.stroke}
                    strokeWidth={isSelected ? 3 : isHovered ? 2.5 : 2}
                  />
                  <foreignObject
                    x={-iconSize / 2}
                    y={-iconSize / 2}
                    width={iconSize}
                    height={iconSize}
                    pointerEvents="none"
                  >
                    <GraphNodeIcon visual={visual} size={Math.round(iconSize * 0.62)} />
                  </foreignObject>
                  {showLabels && labelText && (
                    <text
                      y={r + 14}
                      textAnchor="middle"
                      fill="#e2e8f0"
                      fontSize={10}
                      fontWeight="600"
                      pointerEvents="none"
                    >
                      {labelText}
                    </text>
                  )}
                  {!showLabels && <title>{n.label}</title>}
                  {n.pci && (
                    <text
                      y={r + (showLabels ? 26 : 14)}
                      textAnchor="middle"
                      fill="#f87171"
                      fontSize={8}
                      fontWeight="700"
                      pointerEvents="none"
                    >
                      PCI
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {hoveredNode && !draggingId && (
        <div
          className="pointer-events-none absolute z-20 max-w-xs rounded-lg border border-white/15 bg-surface-900/95 px-3 py-2 text-xs shadow-xl shadow-black/40"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          {formatTooltip(hoveredNode).map((line, i) => (
            <div key={i} className={i === 0 ? 'font-semibold text-white' : 'text-slate-400'}>
              {line}
            </div>
          ))}
        </div>
      )}

      <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-white/10 bg-surface-900/90 px-3 py-2 text-[10px] text-slate-400">
        <span className="font-semibold uppercase tracking-wider text-slate-500">Controls · </span>
        Scroll zoom · drag canvas pan · drag nodes
      </div>

      <div className="absolute bottom-3 left-3 max-w-[75%] space-y-2">
        <div className="rounded-lg border border-white/10 bg-surface-900/90 px-3 py-2 text-[10px] text-slate-400">
          <span className="font-semibold uppercase tracking-wider text-slate-500">Slice · </span>
          {SLICE_LEGEND[slice] || SLICE_LEGEND.component}
        </div>
        <div className="rounded-lg border border-white/10 bg-surface-900/90 px-3 py-2">
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            Node types
          </div>
          <div className="flex flex-wrap gap-1.5">
            {activeNodeTypes.map(({ visual, node }) => {
              const { Icon } = visual;
              const key = visual.awsType || `${normalizeType(node.type)}-${visual.role || 'default'}`;
              const label = formatNodeTypeLabel(node);
              return (
                <span key={key} className="badge-neutral text-[10px]" style={{ borderColor: visual.stroke }}>
                  <span
                    className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full"
                    style={{ background: visual.fill, color: visual.icon || '#fff' }}
                  >
                    <Icon size={10} strokeWidth={2.5} />
                  </span>
                  {label}
                </span>
              );
            })}
          </div>
          {activeEdgeTypes.length > 0 && (
            <>
              <div className="mb-1.5 mt-2 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                Relationships
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeEdgeTypes.map((type) => (
                  <span
                    key={type}
                    className="badge-neutral font-mono text-[9px]"
                    style={{ borderColor: EDGE_COLORS[type] || EDGE_COLORS.default }}
                  >
                    <span
                      className="mr-1 inline-block h-0.5 w-3 align-middle"
                      style={{ background: EDGE_COLORS[type] || EDGE_COLORS.default }}
                    />
                    {type}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

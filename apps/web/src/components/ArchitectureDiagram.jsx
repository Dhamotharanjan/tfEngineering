import { useMemo, useState } from 'react';
import { Cloud, Globe, Lock, Server } from 'lucide-react';
import { resolveNodeVisual } from './graphNodeVisuals';

/**
 * Stamp-ready AWS reference architecture canvas.
 * Nested boundaries: AWS Cloud → Region → AZ columns → VPC → Public/Private subnets.
 * No force/node graph.
 */

const AWS_UI = {
  cloudBorder: '#232F3E',
  regionBorder: '#00A1C1',
  azBorder: '#7AA6B3',
  vpcBorder: '#7B3FF2',
  publicBorder: '#7AA116',
  privateBorder: '#00A1C1',
  canvasBg: '#F7F9FC',
  ink: '#16191F',
  muted: '#545B64',
};

function edgeLabel(e) {
  if (e.label) return String(e.label);
  const pp = e.port || e.protocol ? `${e.port || '?'}/${e.protocol || '?'}` : '';
  if (e.direction === 'ingress' || e.direction === 'egress') {
    return `${String(e.direction).toUpperCase()}${pp ? ` ${pp}` : ''}`.trim();
  }
  return `${e.type || ''}${pp ? ` ${pp}` : ''}`.trim();
}

function ServiceIcon({ node, selected, onClick, ghost = false }) {
  const visual = resolveNodeVisual({
    ...node,
    type: node.type || 'cloudresource',
    detail: node.aws_type || node.detail,
  });
  const Icon = visual.Icon || Server;
  const fill = visual.fill || '#FF9900';

  return (
    <button
      type="button"
      onClick={() => onClick?.(node)}
      title={[node.label, node.aws_type || node.detail, node.facts?.cidr, node.facts?.engine]
        .filter(Boolean)
        .join(' · ')}
      className={`flex w-[88px] flex-col items-center gap-1 rounded px-1 py-1.5 text-center transition ${
        selected ? 'ring-2 ring-offset-1 ring-[#FF9900]' : 'hover:bg-black/[0.04]'
      } ${ghost ? 'opacity-40' : ''}`}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-sm shadow-sm"
        style={{ backgroundColor: fill, color: visual.icon || '#fff' }}
      >
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="line-clamp-2 w-full text-[9px] font-medium leading-tight" style={{ color: AWS_UI.ink }}>
        {node.label}
      </span>
      <span className="line-clamp-1 w-full font-mono text-[8px]" style={{ color: AWS_UI.muted }}>
        {visual.label || node.role}
      </span>
    </button>
  );
}

function SubnetBox({ tier, children, emptyLabel }) {
  const isPublic = tier === 'public';
  const border = isPublic ? AWS_UI.publicBorder : AWS_UI.privateBorder;
  const bg = isPublic ? 'rgba(122,161,22,0.06)' : 'rgba(0,161,193,0.06)';
  return (
    <div
      className="relative min-h-[100px] flex-1 rounded-sm p-2 pt-5"
      style={{ border: `1.5px solid ${border}`, background: bg }}
    >
      <div className="absolute left-2 top-1.5 flex items-center gap-1">
        <Lock className="h-3 w-3" style={{ color: border }} />
        <span className="text-[9px] font-semibold" style={{ color: border }}>
          {isPublic ? 'Public subnet' : 'Private subnet'}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap content-start justify-center gap-1">
        {children}
        {!children?.length && emptyLabel && (
          <span className="py-4 text-[9px] italic" style={{ color: AWS_UI.muted }}>
            {emptyLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function AzColumn({ az, publicNodes, privateNodes, selected, onSelect, ghost }) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-2 rounded-sm p-2 ${ghost ? 'opacity-50' : ''}`}
      style={{
        border: `1.5px dashed ${AWS_UI.azBorder}`,
        background: ghost ? 'rgba(0,0,0,0.02)' : 'rgba(0,161,193,0.03)',
      }}
    >
      <div className="text-center">
        <div className="text-[10px] font-semibold" style={{ color: AWS_UI.regionBorder }}>
          {az.label}
        </div>
        <div className="font-mono text-[9px]" style={{ color: AWS_UI.muted }}>
          {az.short}
          {!az.provisioned && (
            <span className="ml-1 rounded bg-slate-200 px-1 py-0.5 text-[8px] uppercase tracking-wide text-slate-600">
              not provisioned
            </span>
          )}
        </div>
      </div>
      {az.provisioned ? (
        <>
          <SubnetBox tier="public">
            {publicNodes.map((n) => (
              <ServiceIcon key={n.id} node={n} selected={selected === n.id} onClick={onSelect} />
            ))}
          </SubnetBox>
          <SubnetBox tier="private">
            {privateNodes.map((n) => (
              <ServiceIcon key={n.id} node={n} selected={selected === n.id} onClick={onSelect} />
            ))}
          </SubnetBox>
        </>
      ) : (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-slate-300 bg-slate-50/80 px-3 py-8"
        >
          <span className="text-[10px] font-medium text-slate-500">Not provisioned</span>
          <span className="text-center text-[9px] text-slate-400">
            Single-AZ pattern — resources only in AZ-a
          </span>
        </div>
      )}
    </div>
  );
}

function TrafficLegend({ edges, ingress, egress }) {
  const fromTables = [
    ...(ingress || []).slice(0, 6).map((r) => ({
      kind: 'ingress',
      text: `INGRESS ${r.port}/${r.protocol} ← ${r.source}`,
    })),
    ...(egress || []).slice(0, 4).map((r) => ({
      kind: 'egress',
      text: `EGRESS ${r.port}/${r.protocol} → ${r.destination}`,
    })),
  ];
  const fromEdges = (edges || [])
    .filter((e) => e.direction === 'ingress' || e.direction === 'egress' || e.type === 'DATA_PATH' || e.port)
    .slice(0, 8)
    .map((e) => ({
      kind: e.direction === 'egress' ? 'egress' : e.direction === 'ingress' ? 'ingress' : 'path',
      text: edgeLabel(e),
    }));

  const items = fromTables.length ? fromTables : fromEdges;
  if (!items.length) return null;

  return (
    <div className="mt-3 border-t border-slate-200 pt-2">
      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
        Ingress / egress · ports & protocols
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={`${item.text}-${i}`}
            className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
              item.kind === 'ingress'
                ? 'border-emerald-600/40 bg-emerald-50 text-emerald-800'
                : item.kind === 'egress'
                  ? 'border-amber-600/40 bg-amber-50 text-amber-900'
                  : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {item.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function deriveCanvas(architecture) {
  if (architecture?.canvas?.azs?.length) return architecture.canvas;
  const multiAz = architecture?.tier === 'complex';
  const region = 'us-east-1';
  return {
    region,
    multi_az: multiAz,
    azs: [
      { id: 'az:a', key: 'a', label: 'Availability Zone', short: `${region}a`, provisioned: true },
      {
        id: 'az:b',
        key: 'b',
        label: 'Availability Zone',
        short: `${region}b`,
        provisioned: !!multiAz,
      },
    ],
    vpc: { id: 'vpc', label: 'Virtual private cloud (VPC)' },
  };
}

function placeNode(node, canvas) {
  const role = node.role;
  // VPC / CIDR / internet stay outside subnet cells
  if (role === 'vpc' || role === 'cidr' || role === 'route_table') {
    return { zone: 'meta' };
  }
  if (role === 'igw') {
    return { zone: 'edge' };
  }

  let az = node.az || null;
  if (!az && node.facts?.az) {
    const m = String(node.facts.az).match(/([a-f])$/i);
    az = m ? m[1].toLowerCase() : null;
  }
  if (!az && (role === 'rds' || role === 'ec2' || role === 'sg' || role === 'nat' || role === 'kms')) {
    az = 'a';
  }

  let tier = node.subnet_tier;
  if (!tier) {
    if (role === 'nat' || role === 'igw') tier = 'public';
    else if (role === 'rds' || role === 'ec2' || role === 'sg' || role === 'kms') tier = 'private';
    else if (role === 'subnet') {
      const lab = String(node.label || '').toLowerCase();
      tier = lab.includes('public') ? 'public' : 'private';
    } else tier = 'private';
  }

  // Subnet resource nodes are the containers themselves — don't nest icon inside
  if (role === 'subnet') {
    return { zone: 'subnet-frame', az, tier };
  }

  const azMeta = canvas.azs.find((a) => a.key === az);
  if (azMeta && !azMeta.provisioned) {
    return { zone: 'ghost', az, tier };
  }

  return { zone: 'cell', az: az || 'a', tier };
}

export default function ArchitectureDiagram({
  architecture,
  selectedNodeId,
  onNodeClick,
  height = 560,
  fullView = false,
}) {
  const [localSelected, setLocalSelected] = useState(null);
  const selected = selectedNodeId ?? localSelected;

  const canvas = useMemo(() => deriveCanvas(architecture), [architecture]);

  const layout = useMemo(() => {
    const nodes = architecture?.nodes || [];
    const byAz = {};
    for (const az of canvas.azs) {
      byAz[az.key] = { public: [], private: [] };
    }
    const edge = [];
    const meta = [];
    const callouts = [];

    for (const n of nodes) {
      const place = placeNode(n, canvas);
      if (place.zone === 'edge') edge.push(n);
      else if (place.zone === 'meta' || place.zone === 'subnet-frame') {
        if (n.role === 'cidr' && String(n.label).startsWith('0.0.0.0')) callouts.push(n);
        else if (n.role !== 'subnet' && n.role !== 'vpc') meta.push(n);
      } else if (place.zone === 'cell' && place.az && byAz[place.az]) {
        if (place.tier === 'public') byAz[place.az].public.push(n);
        else byAz[place.az].private.push(n);
      }
    }

    return { byAz, edge, meta, callouts };
  }, [architecture, canvas]);

  const onSelect = (node) => {
    const next = selected === node.id ? null : node.id;
    setLocalSelected(next);
    onNodeClick?.(node);
  };

  if (!architecture?.nodes?.length) {
    return (
      <div className="flex items-center justify-center text-sm text-slate-500" style={{ height }}>
        No architecture nodes for this pattern.
      </div>
    );
  }

  const vpcLabel = canvas.vpc?.label || 'Virtual private cloud (VPC)';
  const vpcCidr = canvas.vpc?.cidr;

  return (
    <div
      data-testid="aws-architecture-canvas"
      className="w-full overflow-auto rounded-lg border border-slate-200"
      style={{
        maxHeight: fullView ? undefined : height,
        minHeight: fullView ? height : undefined,
        background: '#FFFFFF',
      }}
    >
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">
          Reference architecture · AWS nested canvas (not a force graph)
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
          <span className="font-mono text-sky-700">{architecture.pattern_id}</span>
          <span>·</span>
          <span>
            {canvas.multi_az ? 'Multi-AZ HA' : 'Single-AZ'} · Region {canvas.region}
          </span>
        </div>
      </div>

      <div className={`flex gap-3 p-3 ${fullView ? 'min-w-[900px]' : ''}`} style={{ minWidth: fullView ? undefined : 640 }}>
        {/* Left stamp callouts */}
        <aside
          className={`hidden shrink-0 flex-col gap-2 sm:flex ${fullView ? 'w-44' : 'w-36'}`}
          style={{ color: AWS_UI.ink }}
        >
          <div
            className="rounded-sm border p-2 text-[9px] leading-snug"
            style={{ borderColor: '#CBD5E1', background: AWS_UI.canvasBg }}
          >
            <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Pattern</div>
            <div className="font-mono text-[10px] text-slate-800">{architecture.pattern_id}</div>
            <div className="mt-1 text-slate-600">{architecture.display_name}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="rounded bg-slate-200 px-1 py-0.5 text-[8px] uppercase text-slate-700">
                {architecture.tier}
              </span>
              <span className="rounded bg-slate-200 px-1 py-0.5 text-[8px] uppercase text-slate-700">
                {architecture.family}
              </span>
            </div>
          </div>
          {(architecture.topology_facts || []).slice(0, 4).map((f) => (
            <div
              key={f}
              className="rounded-sm border border-dashed border-slate-300 bg-white/90 px-2 py-1.5 text-[9px] leading-snug text-slate-600"
            >
              {f}
            </div>
          ))}
          {layout.callouts.slice(0, 2).map((n) => (
            <div
              key={n.id}
              className="rounded-sm border border-sky-300 bg-sky-50 px-2 py-1.5 text-[9px] text-sky-900"
            >
              <Globe className="mb-0.5 inline h-3 w-3" /> {n.label}
            </div>
          ))}
        </aside>

        {/* Main AWS canvas — light document surface for stamp/print */}
        <div className="min-w-0 flex-1" style={{ background: AWS_UI.canvasBg, color: AWS_UI.ink }}>
          <div
            className="relative rounded-sm p-3"
            style={{ border: `2px solid ${AWS_UI.cloudBorder}` }}
          >
            <div className="mb-2 flex items-center gap-1.5">
              <Cloud className="h-4 w-4" style={{ color: AWS_UI.cloudBorder }} />
              <span className="text-[11px] font-semibold" style={{ color: AWS_UI.cloudBorder }}>
                AWS Cloud
              </span>
            </div>

            <div
              className="rounded-sm p-3"
              style={{ border: `2px dashed ${AWS_UI.regionBorder}`, background: '#fff' }}
            >
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold" style={{ color: AWS_UI.regionBorder }}>
                  AWS Region · {canvas.region}
                </span>
                <span className="font-mono text-[9px] text-slate-500">
                  {canvas.multi_az ? 'Multi-AZ' : 'Single-AZ'}
                </span>
              </div>

              {/* Edge strip: IGW */}
              {layout.edge.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center justify-center gap-2 rounded-sm border border-dashed border-violet-300 bg-violet-50/50 px-2 py-1.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-violet-700">
                    Edge
                  </span>
                  {layout.edge.map((n) => (
                    <ServiceIcon key={n.id} node={n} selected={selected === n.id} onClick={onSelect} />
                  ))}
                </div>
              )}

              <div
                className="relative rounded-sm p-2 pt-7"
                style={{ border: `2px solid ${AWS_UI.vpcBorder}`, background: 'rgba(123,63,242,0.03)' }}
              >
                <div className="absolute left-2 top-0 -translate-y-1/2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ background: '#fff', color: AWS_UI.vpcBorder, border: `1px solid ${AWS_UI.vpcBorder}` }}
                  >
                    {vpcLabel}
                    {vpcCidr ? ` · ${vpcCidr}` : ''}
                  </span>
                </div>

                <div className="flex gap-2">
                  {canvas.azs.map((az) => (
                    <AzColumn
                      key={az.id}
                      az={az}
                      publicNodes={layout.byAz[az.key]?.public || []}
                      privateNodes={layout.byAz[az.key]?.private || []}
                      selected={selected}
                      onSelect={onSelect}
                      ghost={!az.provisioned}
                    />
                  ))}
                </div>
              </div>

              {layout.meta.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-2">
                  {layout.meta.map((n) => (
                    <ServiceIcon key={n.id} node={n} selected={selected === n.id} onClick={onSelect} />
                  ))}
                </div>
              )}
            </div>

            <TrafficLegend
              edges={architecture.edges}
              ingress={architecture.ingress}
              egress={architecture.egress}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

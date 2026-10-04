"use client";

import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button, Mono, Panel, Pill, Segmented, Toggle } from "@/components/ui";

type Side = "A" | "B";
type Node = { id: number; on: boolean; side: Side; votes: number };
type Tool = "power" | "partition" | "votes";

const SIDE_COLOR: Record<Side, string> = { A: "var(--color-f1)", B: "var(--color-f4)" };

function makeNodes(n: number): Node[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, on: true, side: "A", votes: 1 }));
}

type Partition = { key: string; ids: number[]; side: Side; nodeVotes: number; qdev: number; votes: number; expected: number; quorum: number; quorate: boolean; overridden: boolean };

export function QuorumSim() {
  const [n, setN] = useState(4);
  const [nodes, setNodes] = useState<Node[]>(() => makeNodes(4));
  const [tool, setTool] = useState<Tool>("partition");
  const [qdevice, setQdevice] = useState(false);
  const [qnetdUp, setQnetdUp] = useState(true);
  const [link1, setLink1] = useState(true);
  const [link0Down, setLink0Down] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState(0);

  const reset = (count = n) => {
    setN(count);
    setNodes(makeNodes(count));
    setOverrides({});
    setLink0Down(false);
    setQnetdUp(true);
  };

  const clickNode = (id: number) => {
    setOverrides({});
    setFlash((f) => f + 1);
    setNodes((ns) =>
      ns.map((x) => {
        if (x.id !== id) return x;
        if (tool === "power") return { ...x, on: !x.on };
        if (tool === "votes") return { ...x, votes: x.votes >= 3 ? 1 : x.votes + 1 };
        return { ...x, side: x.side === "A" ? "B" : "A" };
      }),
    );
  };

  // ---- votequorum math --------------------------------------------------
  const even = n % 2 === 0;
  const qdevVotes = qdevice ? (even ? 1 : n - 1) : 0; // ffsplit gives 1, lms gives N-1
  const algo = even ? "ffsplit" : "lms";
  const expected = nodes.reduce((s, x) => s + x.votes, 0) + qdevVotes;

  const partitions: Partition[] = useMemo(() => {
    const live = nodes.filter((x) => x.on);
    // If the only corosync link dies and there's no redundant link, every node is alone.
    const groups: { ids: number[]; side: Side }[] =
      link0Down && !link1
        ? live.map((x) => ({ ids: [x.id], side: x.side }))
        : (["A", "B"] as Side[])
            .map((s) => ({ ids: live.filter((x) => x.side === s).map((x) => x.id), side: s }))
            .filter((g) => g.ids.length > 0);

    // qnetd votes for the largest partition it can see; tie -> partition with the lowest node id.
    let winner = -1;
    if (qdevice && qnetdUp && groups.length) {
      winner = 0;
      groups.forEach((g, i) => {
        const w = groups[winner];
        if (g.ids.length > w.ids.length || (g.ids.length === w.ids.length && Math.min(...g.ids) < Math.min(...w.ids))) winner = i;
      });
    }

    return groups.map((g, i) => {
      const key = g.ids.join(",");
      const nodeVotes = g.ids.reduce((s, id) => s + nodes[id - 1].votes, 0);
      const qdev = i === winner ? qdevVotes : 0;
      const exp = overrides[key] ?? expected;
      const quorum = Math.floor(exp / 2) + 1;
      return { key, ids: g.ids, side: g.side, nodeVotes, qdev, votes: nodeVotes + qdev, expected: exp, quorum, quorate: nodeVotes + qdev >= quorum, overridden: key in overrides };
    });
  }, [nodes, link0Down, link1, qdevice, qnetdUp, qdevVotes, expected, overrides]);

  const partOf = (id: number) => partitions.find((p) => p.ids.includes(id));
  const quorateCount = partitions.filter((p) => p.quorate).length;
  const splitBrain = quorateCount > 1;

  // ---- geometry ---------------------------------------------------------
  const cx = 200;
  const cy = 170;
  const R = n <= 3 ? 90 : 115;
  const pos = (i: number) => {
    const a = (-90 + (360 / n) * i) * (Math.PI / 180);
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  };
  const qpos = { x: 368, y: 34 };
  const [viewId, setViewId] = useState(1);
  const viewPart = partOf(viewId) ?? partitions[0];

  return (
    <Panel
      title="Quorum simulator"
      right={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-faint">nodes</span>
          <Segmented value={String(n)} options={["2", "3", "4", "5", "6", "7"]} onChange={(v) => reset(Number(v))} />
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-faint">click a node to</span>
          <Segmented
            value={tool}
            onChange={setTool}
            options={[
              { value: "partition", label: "move across the split" },
              { value: "power", label: "power off / on" },
              { value: "votes", label: "change votes" },
            ]}
          />
        </div>
        <Toggle checked={qdevice} onChange={(v) => { setQdevice(v); setOverrides({}); }} label="QDevice" />
        <Toggle checked={link1} onChange={setLink1} label="redundant link1" />
        <Toggle checked={link0Down} onChange={(v) => { setLink0Down(v); setOverrides({}); }} label="link0 switch dies" />
        {qdevice && <Toggle checked={qnetdUp} onChange={setQnetdUp} label="qnetd reachable" />}
        <Button variant="ghost" onClick={() => reset()}>
          ↺ heal
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="relative">
          <svg viewBox="0 0 400 360" className="w-full" role="img" aria-label={`Cluster of ${n} nodes, ${partitions.length} partition(s), ${quorateCount} quorate`}>
            {/* corosync links: knet full mesh, one line per link */}
            {nodes.map((a, i) =>
              nodes.slice(i + 1).map((b, jj) => {
                const j = i + 1 + jj;
                if (!a.on || !b.on) return null;
                const pa = pos(i);
                const pb = pos(j);
                const same = partOf(a.id) === partOf(b.id);
                const dx = pb.x - pa.x;
                const dy = pb.y - pa.y;
                const len = Math.hypot(dx, dy) || 1;
                const ox = (-dy / len) * 2.5;
                const oy = (dx / len) * 2.5;
                const l0ok = !link0Down && same;
                const l1ok = link1 && same;
                return (
                  <g key={`${a.id}-${b.id}`}>
                    <line
                      x1={pa.x - ox} y1={pa.y - oy} x2={pb.x - ox} y2={pb.y - oy}
                      stroke={l0ok ? "var(--color-info)" : "var(--color-bad)"}
                      strokeOpacity={l0ok ? 0.7 : 0.25}
                      strokeWidth={1.2}
                      strokeDasharray={l0ok ? "6 6" : "2 5"}
                      className={l0ok ? "animate-dash" : undefined}
                    />
                    {link1 && (
                      <line
                        x1={pa.x + ox} y1={pa.y + oy} x2={pb.x + ox} y2={pb.y + oy}
                        stroke={l1ok ? "var(--color-accent-2)" : "var(--color-bad)"}
                        strokeOpacity={l1ok ? (link0Down ? 0.85 : 0.35) : 0.2}
                        strokeWidth={1.2}
                        strokeDasharray={l1ok ? "6 6" : "2 5"}
                        className={l1ok && link0Down ? "animate-dash" : undefined}
                      />
                    )}
                  </g>
                );
              }),
            )}

            {/* QDevice */}
            {qdevice && (
              <g>
                {nodes.map((x, i) => {
                  if (!x.on) return null;
                  const p = pos(i);
                  const part = partOf(x.id);
                  const gets = part && part.qdev > 0;
                  return (
                    <line key={x.id} x1={qpos.x} y1={qpos.y} x2={p.x} y2={p.y}
                      stroke={!qnetdUp ? "var(--color-bad)" : gets ? "var(--color-accent)" : "var(--color-faint)"}
                      strokeOpacity={gets ? 0.8 : 0.3} strokeWidth={1} strokeDasharray="3 4"
                      className={gets ? "animate-dash" : undefined} />
                  );
                })}
                <rect x={qpos.x - 30} y={qpos.y - 18} width={60} height={36} rx={6} fill="var(--color-panel-2)" stroke={qnetdUp ? "var(--color-accent)" : "var(--color-bad)"} />
                <text x={qpos.x} y={qpos.y - 3} textAnchor="middle" className="fill-ink font-mono text-[10px]">qnetd</text>
                <text x={qpos.x} y={qpos.y + 10} textAnchor="middle" className="fill-muted font-mono text-[9px]">
                  +{qdevVotes} vote{qdevVotes > 1 ? "s" : ""}
                </text>
              </g>
            )}

            {/* nodes */}
            {nodes.map((x, i) => {
              const p = pos(i);
              const part = partOf(x.id);
              const col = SIDE_COLOR[x.side];
              const quorate = part?.quorate;
              return (
                <g
                  key={x.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`pve${x.id}: ${x.on ? "on" : "off"}, ${x.votes} vote(s), ${quorate ? "quorate" : "not quorate"}`}
                  onClick={() => clickNode(x.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && clickNode(x.id)}
                  className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-ink"
                  onFocus={() => setViewId(x.id)}
                  onMouseEnter={() => x.on && setViewId(x.id)}
                >
                  <circle
                    cx={p.x} cy={p.y} r={27}
                    fill={x.on ? `color-mix(in srgb, ${col} 18%, var(--color-panel))` : "var(--color-bg)"}
                    stroke={!x.on ? "var(--color-line)" : quorate ? "var(--color-ok)" : "var(--color-bad)"}
                    strokeWidth={2}
                    strokeDasharray={x.on ? undefined : "3 3"}
                    style={{ transition: "fill 300ms, stroke 300ms" }}
                  />
                  <text x={p.x} y={p.y - 2} textAnchor="middle" className={clsx("font-mono text-[11px]", x.on ? "fill-ink" : "fill-faint")}>
                    pve{x.id}
                  </text>
                  <text x={p.x} y={p.y + 11} textAnchor="middle" className="fill-muted font-mono text-[9px]">
                    {x.on ? `${x.votes} vote${x.votes > 1 ? "s" : ""}` : "off"}
                  </text>
                  {x.on && (
                    <text x={p.x} y={p.y + 42} textAnchor="middle" className={clsx("font-mono text-[9px]", quorate ? "fill-ok" : "fill-bad")}>
                      {quorate ? "/etc/pve rw" : "/etc/pve ro"}
                    </text>
                  )}
                </g>
              );
            })}

            <g className="font-mono text-[9px]">
              <line x1={10} y1={346} x2={30} y2={346} stroke="var(--color-info)" strokeDasharray="6 6" />
              <text x={34} y={349} className="fill-muted">link0</text>
              {link1 && (
                <>
                  <line x1={74} y1={346} x2={94} y2={346} stroke="var(--color-accent-2)" strokeDasharray="6 6" />
                  <text x={98} y={349} className="fill-muted">link1</text>
                </>
              )}
              <circle cx={146} cy={346} r={4} fill="color-mix(in srgb, var(--color-f1) 40%, transparent)" />
              <text x={153} y={349} className="fill-muted">side A</text>
              <circle cx={198} cy={346} r={4} fill="color-mix(in srgb, var(--color-f4) 40%, transparent)" />
              <text x={205} y={349} className="fill-muted">side B</text>
            </g>
          </svg>
          {link0Down && link1 && (
            <div className="absolute top-1 left-1 rounded-md bg-accent-2/15 px-2 py-1 text-[11px] text-accent-2">knet failed over to link1</div>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <Pill>expected votes {expected}</Pill>
            <Pill>quorum = ⌊{expected}/2⌋+1 = {Math.floor(expected / 2) + 1}</Pill>
            {qdevice && <Pill color="var(--color-accent)">qdevice algorithm {algo}</Pill>}
          </div>

          {splitBrain && (
            <div key={flash} className="animate-flash rounded-lg border border-bad bg-bad/10 px-3 py-2 text-sm text-bad">
              <b>Split brain.</b> Two partitions both think they own /etc/pve. Each can start the same VM on shared storage
              and write the same config files. This is exactly what quorum exists to prevent.
            </div>
          )}

          {partitions.length === 0 && <p className="text-sm text-faint">Every node is off.</p>}
          {partitions.map((p) => (
            <div
              key={p.key}
              className={clsx("animate-rise rounded-lg border p-3", p.quorate ? "border-ok/40 bg-ok/5" : "border-bad/40 bg-bad/5")}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {p.ids.map((id) => (
                    <span key={id} className="rounded px-1.5 py-0.5 font-mono text-[11px]" style={{ background: `color-mix(in srgb, ${SIDE_COLOR[nodes[id - 1].side]} 20%, transparent)` }}>
                      pve{id}
                    </span>
                  ))}
                </div>
                <span className={clsx("font-mono text-xs font-semibold", p.quorate ? "text-ok" : "text-bad")}>
                  {p.quorate ? "QUORATE" : "NO QUORUM"}
                </span>
              </div>
              <div className="mt-2 font-mono text-[11px] text-muted">
                votes {p.nodeVotes}
                {p.qdev > 0 && <span className="text-accent"> + {p.qdev} qdevice</span>} = {p.votes} {p.quorate ? "≥" : "<"} quorum {p.quorum}
                {p.overridden && <span className="text-warn"> (expected forced to {p.expected})</span>}
              </div>
              <ul className="mt-2 space-y-0.5 text-xs leading-relaxed text-muted">
                {p.quorate ? (
                  <>
                    <li>✓ /etc/pve is writable: config changes, start/create guests</li>
                    <li>✓ HA manager may recover services from nodes outside this partition (after fencing)</li>
                  </>
                ) : (
                  <>
                    <li>✗ pmxcfs mounts /etc/pve read-only: no config edits, no <code className="font-mono">qm start</code></li>
                    <li>• running guests keep running, unless they are HA-managed: then the watchdog fences the node</li>
                  </>
                )}
              </ul>
              {!p.quorate && (
                <button
                  type="button"
                  onClick={() => { setOverrides((o) => ({ ...o, [p.key]: 1 })); setFlash((f) => f + 1); }}
                  className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-2 py-1 font-mono text-[11px] text-warn hover:bg-warn/20"
                >
                  # pvecm expected 1 (on pve{p.ids[0]})
                </button>
              )}
            </div>
          ))}

          {viewPart && (
            <div>
              <div className="mb-1 text-[11px] text-faint">
                <span className="font-mono">pvecm status</span> as seen from pve{viewPart.ids.includes(viewId) ? viewId : viewPart.ids[0]} (hover a node)
              </div>
              <Mono className="text-[11px]">
                {`Votequorum information
----------------------
Expected votes:   ${viewPart.expected}
Highest expected: ${viewPart.expected}
Total votes:      ${viewPart.votes}
Quorum:           ${viewPart.quorum}${viewPart.quorate ? "" : "  Activity blocked"}
Flags:            ${[viewPart.quorate ? "Quorate" : null, qdevice ? "Qdevice" : null].filter(Boolean).join(" ") || "-"}`}
              </Mono>
            </div>
          )}
        </div>
      </div>

      <Hint n={n} nodes={nodes} qdevice={qdevice} partitions={partitions} even={even} />
    </Panel>
  );
}

function Hint({ n, nodes, qdevice, partitions, even }: { n: number; nodes: Node[]; qdevice: boolean; partitions: Partition[]; even: boolean }) {
  const off = nodes.filter((x) => !x.on).length;
  let msg: ReactNode;
  if (qdevice && !even)
    msg = (
      <>
        Odd node count: the QDevice runs the <b>lms</b> algorithm and carries <b>N−1 = {n - 1}</b> votes, so a single node
        that can still reach qnetd keeps quorum. Proxmox discourages this: if qnetd itself fails, you can lose quorum where a
        plain {n}-node cluster would not. QDevices are meant for even clusters (and 2-node clusters most of all).
      </>
    );
  else if (n === 2 && !qdevice && off + (partitions.length > 1 ? 1 : 0) > 0)
    msg = (
      <>
        <b>The 2-node problem:</b> 2 votes, quorum 2. Lose either node (or the link between them) and the survivor is not
        quorate, so it can&apos;t start anything. Neither side can tell &ldquo;peer died&rdquo; from &ldquo;cable cut&rdquo;.
        Turn on <b>QDevice</b>: an external tie-breaker gives the surviving side the third vote.
      </>
    );
  else if (n % 2 === 0 && partitions.length === 2 && partitions[0].ids.length === partitions[1].ids.length && !qdevice)
    msg = <>An even split leaves both halves at exactly half the votes. Half is not a majority, so nobody is quorate. A QDevice (ffsplit) breaks the tie.</>;
  else if (qdevice && even && partitions.length === 2 && partitions[0].ids.length === partitions[1].ids.length)
    msg = (
      <>
        Even split with a QDevice: qnetd sees two equal partitions and applies its <b>tie_breaker</b> (default: the
        partition containing the lowest node id). That side gets the extra vote and the majority; the other side stays
        read-only. Exactly one winner, decided by a party that sits outside both halves.
      </>
    );
  else
    msg = (
      <>
        Try it: split the ring, power nodes off, kill link0 with and without a redundant link1, or give one node 2 votes. A
        partition is quorate only with <b>more than half</b> of all expected votes, so at most one partition can ever be
        quorate, unless someone forces it.
      </>
    );
  return <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">{msg}</p>;
}

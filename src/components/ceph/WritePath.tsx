"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Toggle } from "@/components/ui";

const STEPS = [
  {
    title: "Client computes the placement itself",
    body: "librbd in QEMU knows the object name (rbd_data.1a2b….0000000000000007 for bytes 28–32 MiB of the disk). It hashes it to PG 2.1f and runs CRUSH on its copy of the cluster map: [osd.4, osd.9, osd.13]. No metadata server, no lookup table, no single bottleneck.",
  },
  {
    title: "Send to the primary OSD",
    body: "The write goes only to the first OSD of the acting set, the primary, over the public network.",
  },
  {
    title: "Primary fans out to the replicas",
    body: "osd.4 writes to its own BlueStore and, in parallel, forwards the write to osd.9 and osd.13 over the cluster network (if you configured one; otherwise the public network carries this too).",
  },
  {
    title: "Replicas commit and ack",
    body: "Each replica persists the write (BlueStore WAL on fast media) and acknowledges to the primary.",
  },
  {
    title: "Ack to the client",
    body: "Only when every OSD in the acting set has the write durable does the primary ack the client. Latency = two network round trips + the slowest disk. That is why fast networks and consistent NVMe matter more than raw bandwidth.",
  },
] as const;

type Node = { id: string; label: string; sub: string; x: number; y: number };
const NODES: Node[] = [
  { id: "client", label: "VM 100", sub: "librbd on pve1", x: 80, y: 90 },
  { id: "p", label: "osd.4", sub: "primary · pve2", x: 300, y: 90 },
  { id: "r1", label: "osd.9", sub: "replica · pve3", x: 520, y: 40 },
  { id: "r2", label: "osd.13", sub: "replica · pve4", x: 520, y: 140 },
];
const at = (id: string) => NODES.find((n) => n.id === id)!;

function Msg({ from, to, label, color, active }: { from: string; to: string; label: string; color: string; active: boolean }) {
  const a = at(from);
  const b = at(to);
  const d = `M${a.x + (b.x > a.x ? 55 : -55)},${a.y} L${b.x + (b.x > a.x ? -55 : 55)},${b.y}`;
  return (
    <g opacity={active ? 1 : 0} className="transition-opacity duration-300">
      <path d={d} stroke={color} strokeWidth={2} strokeDasharray="6 6" className="animate-dash" fill="none" />
      {active && (
        <circle r={5} fill={color}>
          <animateMotion dur="0.9s" repeatCount="indefinite" path={d} />
        </circle>
      )}
      <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} textAnchor="middle" className="font-mono text-[10px]" fill={color}>
        {label}
      </text>
    </g>
  );
}

export function WritePath() {
  const [stepIdx, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const [clusterNet, setClusterNet] = useState(true);

  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), 2600);
    return () => window.clearTimeout(id);
  }, [auto, stepIdx]);

  const pub = "var(--color-f1)";
  const clu = clusterNet ? "var(--color-f4)" : "var(--color-f1)";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              setAuto(false);
              setStep(i);
            }}
            className={clsx(
              "rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition",
              i === stepIdx ? "border-accent bg-accent/15 text-ink" : "border-line text-muted hover:text-ink",
            )}
          >
            {i + 1}
          </button>
        ))}
        <Button variant="ghost" onClick={() => setAuto((a) => !a)}>
          {auto ? "pause" : "auto-play"}
        </Button>
        <span className="ml-auto">
          <Toggle checked={clusterNet} onChange={setClusterNet} label={<span className="text-xs">separate cluster network</span>} />
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-bg">
        <svg viewBox="0 0 620 190" className="min-w-[520px]" role="img" aria-label={`Ceph write path, step ${stepIdx + 1}: ${STEPS[stepIdx].title}`}>
          <Msg from="client" to="p" label="write" color={pub} active={stepIdx === 1} />
          <Msg from="p" to="r1" label="replicate" color={clu} active={stepIdx === 2} />
          <Msg from="p" to="r2" label="replicate" color={clu} active={stepIdx === 2} />
          <Msg from="r1" to="p" label="ack" color="var(--color-ok)" active={stepIdx === 3} />
          <Msg from="r2" to="p" label="ack" color="var(--color-ok)" active={stepIdx === 3} />
          <Msg from="p" to="client" label="ack" color="var(--color-ok)" active={stepIdx === 4} />
          {NODES.map((n) => {
            const lit =
              (stepIdx === 0 && n.id === "client") ||
              (stepIdx === 1 && (n.id === "client" || n.id === "p")) ||
              (stepIdx === 2 && n.id !== "client") ||
              (stepIdx === 3 && n.id !== "client") ||
              (stepIdx === 4 && (n.id === "client" || n.id === "p"));
            return (
              <g key={n.id} transform={`translate(${n.x - 55},${n.y - 24})`}>
                <rect
                  width={110}
                  height={48}
                  rx={9}
                  fill="var(--color-panel-2)"
                  stroke={lit ? "var(--color-accent)" : "var(--color-line)"}
                  strokeWidth={lit ? 1.8 : 1}
                  className="transition-all duration-300"
                />
                <text x={55} y={21} textAnchor="middle" className="fill-ink font-mono text-[12px]">
                  {n.label}
                </text>
                <text x={55} y={36} textAnchor="middle" className="fill-faint font-mono text-[9.5px]">
                  {n.sub}
                </text>
              </g>
            );
          })}
          {stepIdx === 0 && (
            <text x={80} y={150} textAnchor="middle" className="animate-rise fill-accent font-mono text-[10px]">
              CRUSH(pg 2.1f) → [4, 9, 13]
            </text>
          )}
          <g className="font-mono text-[9.5px]">
            <text x={14} y={180} fill={pub}>
              ━ public network
            </text>
            <text x={140} y={180} fill={clu}>
              ━ {clusterNet ? "cluster network (replication, recovery)" : "same network for replication + recovery"}
            </text>
          </g>
        </svg>
      </div>

      <div key={stepIdx} className="animate-rise">
        <div className="text-sm font-medium">
          {stepIdx + 1}. {STEPS[stepIdx].title}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted">{STEPS[stepIdx].body}</p>
      </div>
    </div>
  );
}

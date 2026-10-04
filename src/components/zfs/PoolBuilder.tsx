"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Button, Segmented, Slider, Stat } from "@/components/ui";

type Layout = "mirror" | "raid10" | "raidz1" | "raidz2" | "raidz3";

const LAYOUTS: { value: Layout; label: string }[] = [
  { value: "mirror", label: "mirror" },
  { value: "raid10", label: "RAID10" },
  { value: "raidz1", label: "RAIDZ1" },
  { value: "raidz2", label: "RAIDZ2" },
  { value: "raidz3", label: "RAIDZ3" },
];

const MIN: Record<Layout, number> = { mirror: 2, raid10: 4, raidz1: 3, raidz2: 4, raidz3: 5 };
const PARITY: Record<Layout, number> = { mirror: 0, raid10: 0, raidz1: 1, raidz2: 2, raidz3: 3 };

type VdevState = "ONLINE" | "DEGRADED" | "UNAVAIL";

function vdevsFor(layout: Layout, n: number): number[][] {
  const ids = Array.from({ length: n }, (_, i) => i);
  if (layout === "raid10") {
    const v: number[][] = [];
    for (let i = 0; i + 1 < n; i += 2) v.push([i, i + 1]);
    return v;
  }
  return [ids];
}

function vdevName(layout: Layout, i: number) {
  return layout === "mirror" || layout === "raid10" ? `mirror-${i}` : `${layout}-${i}`;
}

export function PoolBuilder() {
  const [layout, setLayout] = useState<Layout>("raid10");
  const [count, setCount] = useState(6);
  const [size, setSize] = useState(4);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [resilvering, setResilvering] = useState(false);

  const n = layout === "raid10" ? Math.max(4, count - (count % 2)) : Math.max(MIN[layout], count);
  const vdevs = useMemo(() => vdevsFor(layout, n), [layout, n]);
  const p = PARITY[layout];

  const states: VdevState[] = vdevs.map((v) => {
    const f = v.filter((d) => failed.has(d)).length;
    const tolerate = layout === "mirror" || layout === "raid10" ? v.length - 1 : p;
    if (f === 0) return "ONLINE";
    return f > tolerate ? "UNAVAIL" : "DEGRADED";
  });
  const pool = states.includes("UNAVAIL") ? "FAULTED" : states.includes("DEGRADED") ? "DEGRADED" : "ONLINE";

  const raw = n * size;
  const usable = layout === "mirror" ? size : layout === "raid10" ? (n / 2) * size : (n - p) * size;
  const guaranteed = layout === "mirror" ? n - 1 : layout === "raid10" ? 1 : p;
  const best = layout === "raid10" ? n / 2 : guaranteed;
  const writeIops = layout === "raid10" ? n / 2 : 1;
  const readIops = layout === "mirror" || layout === "raid10" ? n : 1;

  const change = (fn: () => void) => {
    fn();
    setFailed(new Set());
  };
  const toggle = (d: number) => {
    if (resilvering) return;
    setFailed((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };
  const replace = () => {
    setResilvering(true);
    setTimeout(() => {
      setFailed(new Set());
      setResilvering(false);
    }, 1600);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Segmented value={layout} options={LAYOUTS} onChange={(v) => change(() => setLayout(v))} />
        <Slider label="disks" value={count} min={2} max={12} onChange={(v) => change(() => setCount(v))} />
        <Segmented
          value={String(size)}
          options={["1", "4", "8", "16"].map((v) => ({ value: v, label: `${v} TB` }))}
          onChange={(v) => setSize(Number(v))}
        />
      </div>
      {n !== count && (
        <p className="text-xs text-warn">
          {layout} needs {layout === "raid10" ? "an even number of disks, at least 4" : `at least ${MIN[layout]} disks`}: using {n}.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="raw" value={`${raw} TB`} />
        <Stat label="usable ≈" value={`${usable} TB`} tone="good" />
        <Stat label="efficiency" value={`${Math.round((usable / raw) * 100)}%`} />
        <Stat label="survives" value={guaranteed === best ? `${guaranteed} disk${guaranteed > 1 ? "s" : ""}` : `${guaranteed} (≤${best})`} />
        <Stat label="random write IOPS" value={`${writeIops}×`} tone={writeIops > 1 ? "good" : "warn"} />
        <Stat label="random read IOPS" value={`${readIops}×`} tone={readIops > 1 ? "good" : "warn"} />
      </div>

      <div
        className={clsx(
          "rounded-xl border p-4 transition-colors",
          pool === "ONLINE" && "border-ok/40 bg-ok/5",
          pool === "DEGRADED" && "border-warn/50 bg-warn/5",
          pool === "FAULTED" && "border-bad/60 bg-bad/5",
        )}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-sm">
            pool <span className="text-ink">tank</span> · state{" "}
            <span className={clsx("font-semibold", pool === "ONLINE" ? "text-ok" : pool === "DEGRADED" ? "text-warn" : "text-bad")}>{pool}</span>
            {pool === "FAULTED" && <span className="ml-2 text-xs text-bad">(zpool status: UNAVAIL, insufficient replicas)</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-faint">click a disk to fail it</span>
            <Button onClick={replace} disabled={failed.size === 0 || resilvering || pool === "FAULTED"}>
              {resilvering ? "resilvering…" : "zpool replace + resilver"}
            </Button>
            <Button variant="ghost" onClick={() => setFailed(new Set())} disabled={failed.size === 0}>
              reset
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {vdevs.map((v, vi) => (
            <div
              key={vi}
              className={clsx(
                "rounded-lg border p-2",
                states[vi] === "ONLINE" && "border-line",
                states[vi] === "DEGRADED" && "border-warn/60",
                states[vi] === "UNAVAIL" && "border-bad",
              )}
            >
              <div className="mb-1.5 flex items-center justify-between gap-3 font-mono text-[10px]">
                <span className="text-muted">{vdevName(layout, vi)}</span>
                <span className={clsx(states[vi] === "ONLINE" ? "text-ok" : states[vi] === "DEGRADED" ? "text-warn" : "text-bad")}>
                  {states[vi]}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {v.map((d) => {
                  const dead = failed.has(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggle(d)}
                      aria-label={`disk ${d} ${dead ? "failed" : "online"}`}
                      aria-pressed={dead}
                      className={clsx(
                        "relative flex h-14 w-11 flex-col items-center justify-center rounded-md border font-mono text-[10px] transition",
                        dead && !resilvering && "border-bad bg-bad/20 text-bad",
                        dead && resilvering && "animate-pulse-soft border-info bg-info/20 text-info",
                        !dead && "border-line bg-panel-2 text-muted hover:border-faint",
                      )}
                    >
                      <span className="mb-1 h-1 w-6 rounded-full bg-current opacity-60" />
                      sd{String.fromCharCode(97 + d)}
                      <span className="text-[9px]">{dead ? (resilvering ? "new" : "FAULT") : ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {pool === "ONLINE" && "All vdevs healthy. The pool stripes data across every top-level vdev."}
          {pool === "DEGRADED" &&
            "Still serving I/O from the surviving copies or parity, with less (or no) redundancy left. Replace the disk now: a resilver reads only allocated blocks, not the whole disk."}
          {pool === "FAULTED" &&
            "A top-level vdev lost more disks than it can tolerate. Data is striped across all vdevs, so losing any one of them loses the pool. Restore from backup."}
        </p>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import clsx from "clsx";
import { Segmented, Slider, Stat } from "@/components/ui";

type Scheme = "rep3" | "rep2" | "ec21" | "ec42";
const SCHEMES: { value: Scheme; label: string }[] = [
  { value: "rep3", label: "replicated 3" },
  { value: "rep2", label: "replicated 2" },
  { value: "ec21", label: "EC 2+1" },
  { value: "ec42", label: "EC 4+2" },
];
const FACTOR: Record<Scheme, number> = { rep3: 3, rep2: 2, ec21: 1.5, ec42: 1.5 };
const WIDTH: Record<Scheme, number> = { rep3: 3, rep2: 2, ec21: 3, ec42: 6 };
// host failures tolerated while keeping I/O (min_size) / without losing data. Defaults: rep min_size 2, EC min_size k+1.
const SURVIVES: Record<Scheme, string> = { rep3: "1 / 2", rep2: "0 / 1", ec21: "0 / 1", ec42: "1 / 2" };

export function CephCapacity() {
  const [hosts, setHosts] = useState(4);
  const [osds, setOsds] = useState(4);
  const [tb, setTb] = useState(4);
  const [scheme, setScheme] = useState<Scheme>("rep3");
  const [fill, setFill] = useState(55);

  const raw = hosts * osds * tb;
  const usable = raw / FACTOR[scheme];
  // to self-heal after losing a host, the surviving hosts must absorb its data and stay under nearfull
  const safe = ((raw * (hosts - 1)) / hosts / FACTOR[scheme]) * 0.85;
  const stored = (usable * fill) / 100;
  const pct = fill; // of raw, since usable scales linearly
  const afterLoss = (pct * hosts) / (hosts - 1);
  const tooFew = hosts < WIDTH[scheme];
  const canHeal = hosts > WIDTH[scheme];

  const zone = (p: number) => (p >= 95 ? "full" : p >= 90 ? "backfillfull" : p >= 85 ? "nearfull" : "ok");
  const now = zone(pct);
  const later = zone(afterLoss);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Slider label="hosts" value={hosts} min={3} max={8} onChange={setHosts} />
        <Slider label="OSDs / host" value={osds} min={1} max={8} onChange={setOsds} />
        <Slider label="OSD size" value={tb} min={1} max={16} onChange={setTb} format={(v) => `${v} TB`} />
        <Segmented value={scheme} options={SCHEMES} onChange={setScheme} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="raw" value={`${raw} TB`} />
        <Stat label="usable (theory)" value={`${usable.toFixed(1)} TB`} />
        <Stat label="plan to fill ≤" value={`${safe.toFixed(1)} TB`} tone="good" />
        <Stat label="host losses: I/O / data" value={tooFew ? "n/a" : SURVIVES[scheme]} tone={tooFew ? "bad" : undefined} />
      </div>
      {tooFew && (
        <p className="text-xs text-bad">
          {scheme.startsWith("ec") ? `EC ${scheme === "ec21" ? "2+1" : "4+2"}` : "This pool"} needs at least {WIDTH[scheme]} hosts with failure
          domain = host; the PGs cannot even be placed.
        </p>
      )}
      {!tooFew && !canHeal && (
        <p className="text-xs text-warn">
          {hosts} hosts for a pool {WIDTH[scheme]} wide: survives a host failure, but cannot re-create the missing copies until the host returns.
        </p>
      )}

      <Slider label="data stored" value={fill} min={0} max={100} onChange={setFill} format={(v) => `${((usable * v) / 100).toFixed(1)} TB`} />
      {[
        { label: "OSD fill today", p: pct, z: now },
        ...(canHeal ? [{ label: `after losing one host and re-healing on ${hosts - 1}`, p: afterLoss, z: later }] : []),
      ].map((b) => (
        <div key={b.label}>
          <div className="mb-1 flex justify-between text-[11px] text-faint">
            <span className="tracking-wide uppercase">{b.label}</span>
            <span className={clsx("font-mono", b.z === "ok" ? "text-ok" : b.z === "nearfull" ? "text-warn" : "text-bad")}>
              {Math.min(999, b.p).toFixed(0)}% {b.z !== "ok" && `· ${b.z}`}
            </span>
          </div>
          <div className="relative h-5 overflow-hidden rounded-md border border-line bg-bg">
            <div
              className={clsx("h-full transition-all duration-300", b.z === "ok" ? "bg-ok/50" : b.z === "nearfull" ? "bg-warn/60" : "bg-bad/70")}
              style={{ width: `${Math.min(100, b.p)}%` }}
            />
            {[85, 90, 95].map((m) => (
              <div key={m} className="absolute inset-y-0 border-l border-dashed border-ink/40" style={{ left: `${m}%` }} />
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs leading-relaxed text-muted">
        Dashed lines: <span className="font-mono">nearfull 85%</span> (HEALTH_WARN), <span className="font-mono">backfillfull 90%</span> (no more
        backfill into that OSD), <span className="font-mono">full 95%</span> (the cluster stops accepting writes). Ratios are per OSD, so one
        unbalanced OSD hits them first. Stored now: {stored.toFixed(1)} TB.
      </p>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Callout, Segmented, Stat } from "@/components/ui";

const RATE = 40; // MiB of changed blocks per minute
const BASE = 1700000000; // fake epoch seconds for snapshot names

type Sim = {
  t: number; // minutes
  lastSnap: number | null; // time of the newest snapshot on the target
  sending: { at: number; size: number; progress: number } | null;
  nextRun: number;
  history: number[]; // completed sync times
  failed: number | null;
  runs: number;
};

const fresh = (): Sim => ({ t: 0, lastSnap: null, sending: null, nextRun: 0, history: [], failed: null, runs: 0 });

function snapName(min: number) {
  return `__replicate_100-0_${BASE + Math.round(min * 60)}__`;
}
function clock(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${String(2 + h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function Replication() {
  const [interval, setIntervalMin] = useState(15);
  const [running, setRunning] = useState(true);
  const [sim, setSim] = useState<Sim>(fresh);
  const iv = useRef(interval);
  useEffect(() => {
    iv.current = interval;
  }, [interval]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setSim((s) => {
        if (s.failed !== null) return s;
        const dt = iv.current / 50; // one interval ≈ 5 s of real time
        const n = { ...s, t: s.t + dt };
        if (n.sending) {
          const progress = n.sending.progress + 0.12;
          if (progress >= 1) {
            n.lastSnap = n.sending.at;
            n.history = [...n.history, n.sending.at].slice(-8);
            n.sending = null;
          } else n.sending = { ...n.sending, progress };
        }
        if (!n.sending && n.t >= n.nextRun) {
          const delta = n.lastSnap === null ? 32 * 1024 : (n.t - n.lastSnap) * RATE;
          n.sending = { at: n.t, size: delta, progress: 0 };
          n.nextRun = n.t + iv.current;
          n.runs += 1;
        }
        return n;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [running]);

  const fail = () => setSim((s) => ({ ...s, failed: s.t, sending: null }));
  const reset = () => setSim(fresh());

  const atRisk = sim.lastSnap === null ? null : (sim.failed ?? sim.t) - sim.lastSnap;
  const windowStart = Math.max(0, sim.t - interval * 3);
  const span = interval * 3;
  const pos = (m: number) => `${Math.min(100, Math.max(0, ((m - windowStart) / span) * 100))}%`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted">schedule</span>
        <Segmented
          value={String(interval)}
          options={[
            { value: "1", label: "*/1" },
            { value: "5", label: "*/5" },
            { value: "15", label: "*/15 (default)" },
            { value: "60", label: "hourly" },
          ]}
          onChange={(v) => setIntervalMin(Number(v))}
        />
        <Button onClick={() => setRunning((r) => !r)}>{running ? "pause" : "play"}</Button>
        <Button variant="danger" onClick={fail} disabled={sim.failed !== null || sim.lastSnap === null}>
          pull the plug on pve1
        </Button>
        <Button variant="ghost" onClick={reset}>
          reset
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="clock" value={clock(sim.failed ?? sim.t)} />
        <Stat label="last replicated" value={sim.lastSnap === null ? "never" : clock(sim.lastSnap)} />
        <Stat
          label="writes at risk"
          value={atRisk === null ? "all" : `${atRisk.toFixed(1)} min`}
          tone={atRisk === null ? "bad" : atRisk > interval ? "bad" : "warn"}
        />
        <Stat label="≈ data at risk" value={atRisk === null ? "–" : `${Math.round(atRisk * RATE)} MiB`} />
      </div>

      {/* the two nodes */}
      <div className="grid items-center gap-3 md:grid-cols-[1fr_minmax(120px,1fr)_1fr]">
        <Node
          name="pve1"
          role="source · VM 100 running"
          dead={sim.failed !== null}
          snaps={[...(sim.lastSnap !== null ? [sim.lastSnap] : []), ...(sim.sending ? [sim.sending.at] : [])]}
          dirty={sim.failed === null ? (sim.t - (sim.sending?.at ?? sim.lastSnap ?? 0)) * RATE : 0}
          interval={interval}
        />
        <div className="relative h-16">
          <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 40" aria-hidden>
            <line
              x1="0"
              y1="20"
              x2="100"
              y2="20"
              stroke={sim.failed !== null ? "var(--color-bad)" : "var(--color-line)"}
              strokeWidth="1.5"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              className={clsx(sim.sending && "animate-dash")}
            />
          </svg>
          {sim.sending && (
            <div
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-accent bg-accent/20 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-accent transition-[left] duration-100"
              style={{ left: `${sim.sending.progress * 100}%` }}
            >
              {sim.runs === 1 ? "full" : "Δ"} {sim.sending.size >= 1024 ? `${(sim.sending.size / 1024).toFixed(0)} GiB` : `${Math.round(sim.sending.size)} MiB`}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 text-center font-mono text-[10px] text-faint">zfs send -i | ssh | zfs recv</div>
        </div>
        <Node
          name="pve2"
          role={sim.failed !== null ? "target · now runs VM 100" : "target · replica only"}
          snaps={sim.lastSnap !== null ? [sim.lastSnap] : []}
          interval={interval}
          promoted={sim.failed !== null}
        />
      </div>

      {/* timeline */}
      <div>
        <div className="mb-1 text-[11px] tracking-wide text-faint uppercase">timeline</div>
        <div className="relative h-9 overflow-hidden rounded-md border border-line bg-bg">
          {sim.lastSnap !== null && (
            <div
              className={clsx("absolute inset-y-0", sim.failed !== null ? "bg-bad/25" : "bg-warn/15")}
              style={{ left: pos(sim.lastSnap), right: `calc(100% - ${pos(sim.failed ?? sim.t)})` }}
              title="writes not yet on pve2"
            />
          )}
          {sim.history.map((h) => (
            <div key={h} className="absolute inset-y-0 w-0.5 bg-ok" style={{ left: pos(h) }} title={`synced ${clock(h)}`} />
          ))}
          <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: pos(sim.failed ?? sim.t) }} />
          <div className="absolute top-1 right-2 font-mono text-[10px] text-faint">
            <span className="text-ok">|</span> sync <span className="ml-2 text-warn">■</span> not yet replicated
          </div>
        </div>
      </div>

      {sim.failed !== null ? (
        <Callout tone="bad" title={`pve1 died at ${clock(sim.failed)}. HA restarts VM 100 on pve2 from ${sim.lastSnap !== null ? clock(sim.lastSnap) : "…"}.`}>
          Everything the VM wrote in the last <strong className="text-ink">{atRisk?.toFixed(1)} minutes</strong> existed only on pve1 and is gone.
          Replication is asynchronous: the recovery point objective (RPO) is the schedule interval plus the time a sync takes. If you need zero
          data loss, use shared storage (Ceph) instead.
        </Callout>
      ) : (
        <p className="text-xs leading-relaxed text-muted">
          Every run, pvesr takes a new snapshot of each of the guest&apos;s disks, sends only the blocks changed since the last common snapshot (
          <code>zfs send -i</code>) and then deletes the older snapshot on both sides. The first run is a full send. Migration and HA failover can
          then use the replica instead of copying the whole disk.
        </p>
      )}
    </div>
  );
}

function Node({
  name,
  role,
  snaps,
  dirty,
  interval,
  dead,
  promoted,
}: {
  name: string;
  role: string;
  snaps: number[];
  dirty?: number;
  interval: number;
  dead?: boolean;
  promoted?: boolean;
}) {
  const max = interval * RATE * 1.2;
  return (
    <div
      className={clsx(
        "rounded-xl border p-3 transition",
        dead ? "border-bad/60 bg-bad/5 opacity-60" : promoted ? "border-ok/60 bg-ok/5" : "border-line bg-panel-2/50",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-ink">{name}</span>
        <span className={clsx("size-2 rounded-full", dead ? "bg-bad" : "animate-pulse-soft bg-ok")} />
      </div>
      <div className="text-[11px] text-muted">{role}</div>
      <div className="mt-2 font-mono text-[10px] text-faint">rpool/data/vm-100-disk-0</div>
      <ul className="mt-1 min-h-8 space-y-0.5">
        {snaps.map((s) => (
          <li key={s} className="animate-rise truncate font-mono text-[10px] text-accent" title={snapName(s)}>
            @{snapName(s)}
          </li>
        ))}
      </ul>
      {!promoted && dirty !== undefined && (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-bg">
            <div className="h-full bg-warn/70 transition-all duration-100" style={{ width: `${Math.min(100, (dirty / max) * 100)}%` }} />
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-faint">changed since last snapshot: {Math.max(0, Math.round(dirty))} MiB</div>
        </div>
      )}
    </div>
  );
}

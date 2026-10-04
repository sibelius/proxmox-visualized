"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Panel, Toggle } from "@/components/ui";

type Conf = { memory: number; cores: number };
type Msg = { seq: number; from: number; key: keyof Conf; value: number; t0: number };
type NodeState = { conf: Conf; applied: number; log: string[]; flashAt: number; error?: string };

const N = 3;
const TRAVEL = 1600; // ms for a message to go once around the ring
const ANG = [-90, 30, 150]; // node angles on the ring
const C = { x: 160, y: 125, r: 82 };
const MEM = [2048, 4096, 8192, 16384];
const CORES = [1, 2, 4, 8];

const pt = (deg: number, r = C.r) => ({ x: C.x + r * Math.cos((deg * Math.PI) / 180), y: C.y + r * Math.sin((deg * Math.PI) / 180) });
const initial = (): NodeState[] => Array.from({ length: N }, () => ({ conf: { memory: 4096, cores: 2 }, applied: 0, log: [], flashAt: 0 }));

export function PmxcfsDemo() {
  const [nodes, setNodes] = useState<NodeState[]>(initial);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [now, setNow] = useState(0);
  const [isolated, setIsolated] = useState(false);
  const seq = useRef(0);
  const delivered = useRef<Set<string>>(new Set());

  const members = isolated ? [0, 1] : [0, 1, 2];

  // animation clock while messages are in flight, plus a slow idle token
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // deliver: a member receives msg when the packet passes its angle; it applies messages strictly in seq order
  useEffect(() => {
    if (!msgs.length) return;
    let changed = false;
    const next = nodes.map((nd, i) => {
      if (!members.includes(i)) return nd;
      let s = nd;
      for (;;) {
        const m = msgs.find((x) => x.seq === s.applied + 1);
        if (!m) break;
        const arrived = arrivedAt(m, i, now);
        if (!arrived) break;
        const k = `${m.seq}:${i}`;
        if (delivered.current.has(k)) break;
        delivered.current.add(k);
        changed = true;
        s = {
          ...s,
          conf: { ...s.conf, [m.key]: m.value },
          applied: m.seq,
          flashAt: now,
          log: [`#${m.seq} from pve${m.from + 1}: ${m.key}: ${m.value}`, ...s.log].slice(0, 4),
        };
      }
      return s;
    });
    if (changed) setNodes(next);
    // drop messages everyone has applied
    const minApplied = Math.min(...members.map((i) => next[i].applied));
    if (msgs.some((m) => m.seq <= minApplied && now - m.t0 > TRAVEL)) setMsgs((ms) => ms.filter((m) => m.seq > minApplied || now - m.t0 <= TRAVEL));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  function arrivedAt(m: Msg, i: number, t: number) {
    const span = (((ANG[i] - ANG[m.from]) % 360) + 360) % 360; // degrees the packet travels from sender to node i
    return (t - m.t0) / TRAVEL >= span / 360;
  }

  const write = (from: number, key: keyof Conf, value: number, t0 = performance.now()) => {
    if (!members.includes(from)) {
      setNodes((ns) => ns.map((nd, i) => (i === from ? { ...nd, error: `${Date.now()}`, flashAt: performance.now() } : nd)));
      return;
    }
    // totem: the token holder stamps a global sequence number; everyone delivers in that order
    seq.current += 1;
    const m: Msg = { seq: seq.current, from, key, value, t0 };
    setMsgs((ms) => [...ms, m]);
  };

  const bump = (i: number, key: keyof Conf) => {
    const arr = key === "memory" ? MEM : CORES;
    const cur = nodes[i].conf[key];
    write(i, key, arr[(arr.indexOf(cur) + 1) % arr.length]);
  };

  const race = () => {
    const t = performance.now();
    write(0, "memory", 8192, t);
    write(isolated ? 1 : 2, "memory", 2048, t);
  };

  const toggleIsolated = (v: boolean) => {
    setIsolated(v);
    if (!v) {
      // rejoin: pmxcfs resyncs pve3 from the quorate partition's state
      setNodes((ns) => ns.map((nd, i) => (i === 2 ? { ...nd, conf: { ...ns[0].conf }, applied: ns[0].applied, flashAt: performance.now(), error: undefined, log: ["resync: state copied from quorate members", ...nd.log].slice(0, 4) } : nd)));
    }
  };

  const tokenAngle = ((now / 2400) * 360) % 360;

  return (
    <Panel
      title="pmxcfs: one file, three copies, one order"
      right={
        <div className="flex flex-wrap items-center gap-3">
          <Toggle checked={isolated} onChange={toggleIsolated} label="cut pve3 off" />
          <Button onClick={race}>⚡ concurrent writes</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <svg viewBox="0 0 320 250" className="mx-auto w-full max-w-[340px]" role="img" aria-label="Corosync totem ring carrying ordered messages between three nodes">
          <circle cx={C.x} cy={C.y} r={C.r} fill="none" stroke="var(--color-line)" strokeWidth={10} />
          <circle cx={C.x} cy={C.y} r={C.r} fill="none" stroke="var(--color-info)" strokeOpacity={0.4} strokeDasharray="6 6" className="animate-dash" />
          {/* the token */}
          <circle cx={pt(tokenAngle).x} cy={pt(tokenAngle).y} r={4} fill="var(--color-warn)" />
          <text x={C.x} y={C.y - 4} textAnchor="middle" className="fill-faint font-mono text-[10px]">corosync totem</text>
          <text x={C.x} y={C.y + 10} textAnchor="middle" className="fill-faint font-mono text-[9px]">agreed order</text>
          {msgs.map((m) => {
            const p = Math.min(1, (now - m.t0) / TRAVEL);
            if (p >= 1) return null;
            const q = pt(ANG[m.from] + p * 360);
            return (
              <g key={m.seq}>
                <circle cx={q.x} cy={q.y} r={9} fill={m.from === 0 ? "var(--color-f1)" : m.from === 1 ? "var(--color-f2)" : "var(--color-f4)"} />
                <text x={q.x} y={q.y + 3} textAnchor="middle" className="fill-bg font-mono text-[9px] font-bold">{m.seq}</text>
              </g>
            );
          })}
          {ANG.map((a, i) => {
            const p = pt(a, C.r + (i === 0 ? 0 : 0));
            const off = isolated && i === 2;
            return (
              <g key={i}>
                <rect x={p.x - 30} y={p.y - 16} width={60} height={32} rx={8} fill="var(--color-panel-2)" stroke={off ? "var(--color-bad)" : "var(--color-line)"} strokeDasharray={off ? "3 3" : undefined} />
                <text x={p.x} y={p.y + 4} textAnchor="middle" className={clsx("font-mono text-[11px]", off ? "fill-bad" : "fill-ink")}>pve{i + 1}</text>
              </g>
            );
          })}
        </svg>

        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          {nodes.map((nd, i) => {
            const off = isolated && i === 2;
            return (
              <div key={i} className={clsx("min-w-0 rounded-lg border bg-bg p-3", off ? "border-bad/50" : "border-line")}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs text-ink">pve{i + 1}</span>
                  <span className={clsx("font-mono text-[10px]", off ? "text-bad" : "text-ok")}>{off ? "ro · no quorum" : "rw · quorate"}</span>
                </div>
                <div className="truncate font-mono text-[10px] text-faint">/etc/pve/qemu-server/100.conf</div>
                <pre key={nd.flashAt} className={clsx("mt-1 rounded border border-line bg-panel px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted", nd.flashAt && "animate-flash")}>
                  {`name: web01
cores: ${nd.conf.cores}
memory: ${nd.conf.memory}
net0: virtio,bridge=vmbr0`}
                </pre>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => bump(i, "memory")} className="rounded border border-line bg-panel-2 px-2 py-0.5 font-mono text-[10px] text-ink hover:border-faint">
                    write memory
                  </button>
                  <button type="button" onClick={() => bump(i, "cores")} className="rounded border border-line bg-panel-2 px-2 py-0.5 font-mono text-[10px] text-ink hover:border-faint">
                    write cores
                  </button>
                </div>
                {nd.error && off && (
                  <div key={nd.error} className="mt-2 animate-rise rounded bg-bad/10 px-2 py-1 font-mono text-[10px] text-bad">
                    write failed: Permission denied
                  </div>
                )}
                <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-faint">
                  {nd.log.map((l, k) => (
                    <li key={k + l} className={clsx("truncate", k === 0 && "text-muted")}>{l}</li>
                  ))}
                </ul>
                <div className="mt-1 font-mono text-[10px] text-faint">applied up to #{nd.applied}</div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">
        Every write to <code className="font-mono">/etc/pve</code> becomes a corosync message. Totem stamps it with a global
        sequence number, and every node applies messages in exactly that order, even its own. Hit{" "}
        <b className="text-ink">concurrent writes</b>: pve1 and pve3 each set a different memory size at the same instant.
        pve3 sees its own packet first but must wait for the lower-numbered one, so all three apply both writes in the same order and converge to the same value. Cut pve3
        off and its writes fail: a node without quorum cannot change the shared truth. When it rejoins, it resyncs.
      </p>
    </Panel>
  );
}

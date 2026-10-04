"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Panel, Pill, Segmented, Toggle } from "@/components/ui";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
type NodeId = "pve1" | "pve2" | "pve3" | "pve4";
const NODES: NodeId[] = ["pve1", "pve2", "pve3", "pve4"];
const CAP: Record<NodeId, { cpu: number; mem: number }> = {
  pve1: { cpu: 32, mem: 128 },
  pve2: { cpu: 16, mem: 64 },
  pve3: { cpu: 32, mem: 128 },
  pve4: { cpu: 32, mem: 128 },
};

type Res = { sid: string; name: string; home: NodeId; cpu: number; mem: number; ha: boolean };
const RES: Res[] = [
  { sid: "vm:100", name: "db01", home: "pve1", cpu: 8, mem: 32, ha: true },
  { sid: "vm:101", name: "web01", home: "pve1", cpu: 2, mem: 4, ha: true },
  { sid: "vm:102", name: "web02", home: "pve2", cpu: 2, mem: 4, ha: true },
  { sid: "ct:103", name: "dns", home: "pve2", cpu: 1, mem: 1, ha: true },
  { sid: "vm:104", name: "app", home: "pve3", cpu: 4, mem: 16, ha: true },
  { sid: "vm:105", name: "ci", home: "pve4", cpu: 8, mem: 24, ha: true },
  { sid: "vm:200", name: "scratch", home: "pve1", cpu: 2, mem: 8, ha: false },
];

type NodeAffinity = { id: string; resources: string[]; nodes: Partial<Record<NodeId, number>>; strict: boolean };
const NODE_RULES: NodeAffinity[] = [
  { id: "db-prefers-pve1", resources: ["vm:100"], nodes: { pve1: 2, pve2: 1 }, strict: false },
  { id: "app-only-pve3-4", resources: ["vm:104"], nodes: { pve3: 1, pve4: 1 }, strict: true },
];
const APART = { id: "web-apart", resources: ["vm:101", "vm:102"] }; // negative resource affinity

type Fail = "power" | "isolated";
type Crs = "basic" | "static";

// timeline constants (seconds)
const T_UNKNOWN = 10; // CRM notices the node left the quorate membership
const T_FENCE = 12; //  -> node state 'fence', its services go to 'fence'
const T_WATCHDOG = 60; // isolated node: watchdog-mux not fed for 60 s -> reset
const T_LOCK = 120; // CRM can take the dead node's LRM lock -> fenced for sure
const T_START = 128; // recovered services are running on new nodes
const T_BACK = 175; // the failed node boots again
const T_FAILBACK = 185; // failback migration starts
const T_FAILBACK_DONE = 195;
const T_END = 210;

const MASTER: NodeId = "pve1";
/** When the failed node was also the CRM master, nobody can act until a standby CRM takes the manager lock (also ~120 s). */
function times(failed: NodeId) {
  const m = failed === MASTER;
  const lock = m ? T_LOCK + 4 : T_LOCK;
  return { unknown: m ? T_LOCK : T_UNKNOWN, fence: m ? T_LOCK + 2 : T_FENCE, lock, start: lock + (T_START - T_LOCK) };
}

type Placement = { sid: string; to: NodeId | null; why: string };

function place(failed: NodeId, crs: Crs): Placement[] {
  const live = NODES.filter((n) => n !== failed);
  const where: Record<string, NodeId> = Object.fromEntries(RES.filter((r) => r.ha).map((r) => [r.sid, r.home]));
  const load = (n: NodeId) => {
    const rs = RES.filter((r) => r.ha && where[r.sid] === n);
    return { count: rs.length, cpu: rs.reduce((s, r) => s + r.cpu, 0), mem: rs.reduce((s, r) => s + r.mem, 0) };
  };
  const out: Placement[] = [];
  for (const r of RES.filter((x) => x.ha && x.home === failed)) {
    let cands = live;
    const why: string[] = [];
    const rule = NODE_RULES.find((g) => g.resources.includes(r.sid));
    if (rule) {
      const allowed = live.filter((n) => rule.nodes[n] !== undefined);
      if (allowed.length) {
        const top = Math.max(...allowed.map((n) => rule.nodes[n]!));
        cands = allowed.filter((n) => rule.nodes[n] === top);
        why.push(`node-affinity ${rule.id}: priority ${top} → ${cands.join(", ")}`);
      } else if (rule.strict) {
        out.push({ sid: r.sid, to: null, why: `strict node-affinity ${rule.id}: no allowed node online, stays in recovery` });
        continue;
      } else why.push(`node-affinity ${rule.id}: no preferred node online, any node allowed`);
    }
    if (APART.resources.includes(r.sid)) {
      const partners = APART.resources.filter((s) => s !== r.sid).map((s) => where[s]);
      const left = cands.filter((n) => !partners.includes(n));
      if (left.length) {
        if (left.length !== cands.length) why.push(`resource-affinity ${APART.id} (negative): not on ${partners.join(", ")}`);
        cands = left;
      }
    }
    const score = (n: NodeId) => {
      const l = load(n);
      if (crs === "basic") return l.count;
      return Math.max((l.cpu + r.cpu) / CAP[n].cpu, (l.mem + r.mem) / CAP[n].mem);
    };
    const best = [...cands].sort((a, b) => score(a) - score(b) || a.localeCompare(b))[0];
    if (cands.length > 1)
      why.push(
        crs === "basic"
          ? `CRS basic: fewest HA services (${cands.map((n) => `${n}=${load(n).count}`).join(", ")})`
          : `CRS static: lowest projected usage (${cands.map((n) => `${n}=${Math.round(score(n) * 100)}%`).join(", ")})`,
      );
    where[r.sid] = best;
    out.push({ sid: r.sid, to: best, why: why.join(" · ") || "any node" });
  }
  return out;
}

type RState = "started" | "fence" | "recovery" | "migrate" | "stopped" | "lost";
type View = {
  nodeState: Record<NodeId, string>;
  res: { sid: string; node: NodeId | null; state: RState; ghost?: boolean }[];
  watchdog: number | null;
  master: NodeId | null;
};

function viewAt(t: number, failed: NodeId | null, fail: Fail, fencing: boolean, plan: Placement[]): View {
  const nodeState = Object.fromEntries(NODES.map((n) => [n, "online"])) as Record<NodeId, string>;
  const master: NodeId | null = failed === MASTER ? (t >= T_LOCK ? "pve2" : null) : MASTER;
  if (!failed) return { nodeState, res: RES.map((r) => ({ sid: r.sid, node: r.home, state: "started" })), watchdog: null, master };

  const T = times(failed);
  const back = t >= T_BACK;
  if (back) nodeState[failed] = "online";
  else if (t >= T.lock) nodeState[failed] = fencing ? "fenced" : "presumed fenced";
  else if (t >= T.fence) nodeState[failed] = "fence";
  else if (t >= T.unknown) nodeState[failed] = "unknown";
  else nodeState[failed] = fail === "power" ? "online?" : "online (no quorum)";

  const oldAlive = fail === "isolated" && (t < T_WATCHDOG || !fencing) && !back;
  const watchdog = fail === "isolated" && fencing && t < T_WATCHDOG ? Math.max(0, T_WATCHDOG - t) : null;

  const res: View["res"] = [];
  for (const r of RES) {
    if (r.home !== failed) {
      res.push({ sid: r.sid, node: r.home, state: "started" });
      continue;
    }
    if (!r.ha) {
      res.push({ sid: r.sid, node: failed, state: oldAlive ? "started" : back ? "stopped" : "lost" });
      continue;
    }
    const p = plan.find((x) => x.sid === r.sid)!;
    // the old copy, as seen from the failed node itself
    if (oldAlive && t >= T.lock && p.to) res.push({ sid: r.sid, node: failed, state: "started", ghost: true });
    if (t < T.fence) res.push({ sid: r.sid, node: failed, state: oldAlive ? "started" : "lost" });
    else if (t < T.lock) res.push({ sid: r.sid, node: failed, state: "fence" });
    else if (!p.to) res.push({ sid: r.sid, node: null, state: "recovery" });
    else if (t < T.start) res.push({ sid: r.sid, node: p.to, state: "recovery" });
    else {
      const rule = NODE_RULES.find((g) => g.resources.includes(r.sid));
      const prefersHome = rule && (rule.nodes[failed] ?? -1) > (rule.nodes[p.to] ?? -1);
      if (prefersHome && t >= T_FAILBACK_DONE) res.push({ sid: r.sid, node: failed, state: "started" });
      else if (prefersHome && t >= T_FAILBACK) res.push({ sid: r.sid, node: p.to, state: "migrate" });
      else res.push({ sid: r.sid, node: p.to, state: "started" });
    }
  }
  return { nodeState, res, watchdog, master };
}

function events(failed: NodeId, fail: Fail, fencing: boolean, plan: Placement[]) {
  const ev: { t: number; text: string; tone: "bad" | "warn" | "info" | "ok" | "muted" }[] = [];
  ev.push({
    t: 0,
    text:
      fail === "power"
        ? `${failed} loses power. Its guests die instantly; nobody else knows yet.`
        : `${failed}'s corosync link fails. It is alive, guests still run, but it is alone and not quorate.`,
    tone: "bad",
  });
  if (fail === "isolated")
    ev.push({ t: 1, text: `pve-ha-lrm on ${failed} cannot renew its lock in /etc/pve (read-only) and stops feeding watchdog-mux.`, tone: "warn" });
  const T = times(failed);
  if (failed === MASTER)
    ev.push({ t: 5, text: `${failed} was also the CRM master. Nobody manages the cluster until its ha_manager_lock expires and a standby CRM takes over.`, tone: "warn" });
  ev.push({ t: T.unknown, text: `${failed === MASTER ? "New master CRM on pve2" : `CRM (master on ${MASTER})`} sees ${failed} left the quorate membership → node state 'unknown'.`, tone: "info" });
  ev.push({ t: T.fence, text: `Node → 'fence'. Its HA services → 'fence'. The CRM must not start them elsewhere until it can prove the node is dead.`, tone: "warn" });
  if (fail === "isolated")
    ev.push(
      fencing
        ? { t: T_WATCHDOG, text: `Watchdog expires on ${failed} → hard reset. Self-fenced: its guests are now definitely stopped.`, tone: "bad" }
        : { t: T_WATCHDOG, text: `(no fencing) ${failed} keeps running its guests, still writing to the shared disk…`, tone: "bad" },
    );
  ev.push({
    t: T.lock,
    text: `${failed}'s LRM lock (ha_agent_${failed}_lock) has expired; the CRM acquires it. Fencing is complete → services 'recovery'.`,
    tone: "info",
  });
  for (const p of plan)
    ev.push({ t: T.lock + 2, text: p.to ? `${p.sid} → ${p.to}  (${p.why})` : `${p.sid}: ${p.why}`, tone: p.to ? "muted" : "bad" });
  if (fail === "isolated" && !fencing)
    ev.push({ t: T.lock + 3, text: "SPLIT BRAIN: the same VMs now run twice against one disk. Filesystems corrupt within seconds.", tone: "bad" });
  ev.push({ t: T.start, text: "Recovered services are started on their new nodes → 'started'.", tone: "ok" });
  ev.push({ t: T_BACK, text: `${failed} boots again, rejoins the cluster, LRM becomes active.`, tone: "info" });
  const fb = plan.filter((p) => {
    const rule = NODE_RULES.find((g) => g.resources.includes(p.sid));
    return p.to && rule && (rule.nodes[failed] ?? -1) > (rule.nodes[p.to] ?? -1);
  });
  if (fb.length) ev.push({ t: T_FAILBACK, text: `failback: ${fb.map((p) => p.sid).join(", ")} prefer ${failed} (higher priority) → live-migrate back.`, tone: "info" });
  return ev.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const STATE_COLOR: Record<RState, string> = {
  started: "var(--color-ok)",
  fence: "var(--color-bad)",
  recovery: "var(--color-warn)",
  migrate: "var(--color-info)",
  stopped: "var(--color-faint)",
  lost: "var(--color-faint)",
};

export function HaSim() {
  const [failed, setFailed] = useState<NodeId>("pve1");
  const [fail, setFail] = useState<Fail>("isolated");
  const [fencing, setFencing] = useState(true);
  const [crs, setCrs] = useState<Crs>("basic");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("10");
  const last = useRef(0);

  const plan = useMemo(() => place(failed, crs), [failed, crs]);
  const ev = useMemo(() => events(failed, fail, fencing, plan), [failed, fail, fencing, plan]);
  const started = t > 0 || playing;
  const v = viewAt(t, started ? failed : null, fail, fencing, plan);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    last.current = performance.now();
    const loop = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((x) => {
        const nx = Math.min(T_END, x + dt * Number(speed));
        if (nx >= T_END) setPlaying(false);
        return nx;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const reset = () => {
    setPlaying(false);
    setT(0);
  };
  const pick = (n: NodeId) => {
    setFailed(n);
    reset();
  };

  const splitBrain = fail === "isolated" && !fencing && t >= times(failed).lock + 3 && t < T_BACK;

  return (
    <Panel
      title="HA failover simulator"
      right={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={speed} onChange={setSpeed} options={[{ value: "5", label: "5×" }, { value: "10", label: "10×" }, { value: "25", label: "25×" }]} />
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-faint">failure</span>
          <Segmented
            value={fail}
            onChange={(x) => { setFail(x); reset(); }}
            options={[{ value: "isolated", label: "network isolation" }, { value: "power", label: "power loss" }]}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-faint">scheduler</span>
          <Segmented value={crs} onChange={(x) => { setCrs(x); reset(); }} options={[{ value: "basic", label: "CRS basic" }, { value: "static", label: "CRS static" }]} />
        </div>
        {fail === "isolated" && <Toggle checked={!fencing} onChange={(x) => { setFencing(!x); reset(); }} label="what if there were no fencing?" />}
        <div className="ml-auto flex gap-2">
          <Button variant="primary" onClick={() => (t >= T_END ? (setT(0), setPlaying(true)) : setPlaying(!playing))}>
            {playing ? "❚❚ pause" : t > 0 && t < T_END ? "▶ resume" : `▶ fail ${failed}`}
          </Button>
          <Button variant="ghost" onClick={reset}>↺</Button>
        </div>
      </div>

      {/* nodes */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {NODES.map((n) => {
          const isFailed = started && n === failed;
          const dead = isFailed && ((fail === "power" && t < T_BACK) || (fail === "isolated" && fencing && t >= T_WATCHDOG && t < T_BACK));
          const rs = v.res.filter((r) => r.node === n);
          return (
            <div
              key={n}
              role="button"
              tabIndex={0}
              onClick={() => pick(n)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick(n)}
              aria-label={`${n}: ${v.nodeState[n]}. Click to choose it as the node that fails.`}
              className={clsx(
                "min-h-48 cursor-pointer rounded-lg border p-3 transition",
                n === failed ? "border-bad/60" : "border-line hover:border-faint",
                dead ? "bg-bg opacity-60" : "bg-panel-2/40",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-sm text-ink">{n}</span>
                {v.master === n && <Pill color="var(--color-accent)">CRM master</Pill>}
              </div>
              <div className={clsx("mt-1 font-mono text-[11px]", v.nodeState[n] === "online" ? "text-ok" : "text-bad")}>
                {dead ? (fail === "power" ? "powered off" : "reset by watchdog") : v.nodeState[n]}
              </div>
              <div className="mt-1 font-mono text-[10px] text-faint">
                {CAP[n].cpu}c / {CAP[n].mem}G · {n === failed && !started ? "click ▶ to fail" : "lrm: " + (isFailed && t < T_BACK ? (dead ? "-" : "lost lock") : "active")}
              </div>
              {isFailed && v.watchdog !== null && (
                <div className="mt-2">
                  <div className="flex justify-between font-mono text-[10px] text-warn">
                    <span>watchdog</span>
                    <span>{Math.ceil(v.watchdog)}s</span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-bg">
                    <div className="h-full bg-warn" style={{ width: `${(v.watchdog / 60) * 100}%` }} />
                  </div>
                </div>
              )}
              <ul className="mt-3 space-y-1.5">
                {rs.map((r) => {
                  const meta = RES.find((x) => x.sid === r.sid)!;
                  return (
                    <li
                      key={r.sid + r.node + (r.ghost ? "g" : "")}
                      className={clsx("animate-rise rounded-md border px-2 py-1 text-[11px]", r.ghost && "animate-pulse-soft")}
                      style={{ borderColor: `color-mix(in srgb, ${r.ghost ? "var(--color-bad)" : STATE_COLOR[r.state]} 50%, transparent)` }}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className={clsx("font-mono", r.state === "lost" ? "text-faint line-through" : "text-ink")}>
                          {r.sid} <span className="text-faint">{meta.name}</span>
                        </span>
                        {!meta.ha && <span className="font-mono text-[9px] text-faint">no HA</span>}
                      </div>
                      <div className="font-mono text-[10px]" style={{ color: r.ghost ? "var(--color-bad)" : STATE_COLOR[r.state] }}>
                        {r.ghost ? "still running here!" : r.state}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {v.res.some((r) => r.node === null) && (
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 font-mono text-xs text-warn">
          {v.res.filter((r) => r.node === null).map((r) => r.sid).join(", ")}: recovery — no node allowed by a strict rule is online
        </div>
      )}
      {splitBrain && (
        <div className="mt-3 animate-flash rounded-lg border border-bad bg-bad/10 px-3 py-2 text-sm text-bad">
          Two copies of the same VM are writing to the same shared disk. This is why HA refuses to recover anything until the
          failed node has provably fenced itself.
        </div>
      )}

      {/* timeline */}
      <div className="mt-5">
        <div className="relative h-8">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-line" />
          <div className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded bg-accent" style={{ width: `${(t / T_END) * 100}%` }} />
          {[...new Set(ev.map((e) => e.t))].map((et) => (
            <span
              key={et}
              className={clsx("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel", et <= t ? "bg-accent" : "bg-faint")}
              style={{ left: `${(et / T_END) * 100}%` }}
            />
          ))}
          <input
            type="range"
            min={0}
            max={T_END}
            step={0.5}
            value={t}
            aria-label="timeline"
            onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          />
        </div>
        <div className="relative h-4 font-mono text-[10px] text-faint">
          {fail === "isolated" && fencing && (
            <span className="absolute -translate-x-1/2 text-warn" style={{ left: `${(T_WATCHDOG / T_END) * 100}%` }}>
              watchdog 60s
            </span>
          )}
          <span className="absolute -translate-x-1/2 text-info" style={{ left: `${(T_LOCK / T_END) * 100}%` }}>
            lock expiry
          </span>
        </div>
        <div className="flex justify-between font-mono text-[10px] text-faint">
          <span>0 s</span>
          <span className="text-ink">t = {Math.floor(t)} s</span>
          <span>{T_END} s</span>
        </div>
      </div>

      <ol className="mt-3 max-h-64 space-y-1 overflow-y-auto">
        {ev.filter((e) => e.t <= t && started).map((e, i) => (
          <li key={i} className="grid animate-rise grid-cols-[52px_1fr] gap-2 text-xs">
            <span className="text-right font-mono text-faint tabular-nums">+{e.t}s</span>
            <span className={clsx(e.tone === "bad" && "text-bad", e.tone === "warn" && "text-warn", e.tone === "info" && "text-info", e.tone === "ok" && "text-ok", e.tone === "muted" && "font-mono text-[11px] text-muted")}>
              {e.text}
            </span>
          </li>
        ))}
        {!started && <li className="py-3 text-center text-sm text-faint">Click a node to choose the victim, pick a failure type, then press ▶.</li>}
      </ol>
    </Panel>
  );
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Callout, Segmented, Toggle } from "@/components/ui";
import { crush, hash, type Osd } from "./crush";

const OSD_PER_HOST = 3;
const PG_NUM = 32;
const OUT_AFTER = 600; // mon_osd_down_out_interval
const POOL_ID = 2;
const TICK_MS = 200;
const BF_STEP = 0.11;

type Pg = { have: number[]; bf: Record<number, number> };
type LogLine = { t: number; msg: string; tone: "info" | "warn" | "bad" | "ok" };
type Sim = { t: number; osds: Osd[]; pgs: Pg[]; hostDown: boolean[]; log: LogLine[]; wasClean: boolean };
type Kind = "clean" | "degraded" | "backfill" | "peered" | "stale";

const KIND_STYLE: Record<Kind, { bg: string; text: string; label: string }> = {
  clean: { bg: "bg-ok/70", text: "text-ok", label: "active+clean" },
  degraded: { bg: "bg-warn/70", text: "text-warn", label: "active+undersized+degraded" },
  backfill: { bg: "bg-info/70", text: "text-info", label: "active+remapped+backfilling" },
  peered: { bg: "bg-bad/80", text: "text-bad", label: "undersized+degraded+peered (I/O blocked)" },
  stale: { bg: "bg-bad/30 border border-bad", text: "text-bad", label: "stale+down (no copy reachable)" },
};

const OBJECTS = Array.from({ length: 8 }, (_, i) => `rbd_data.1a2b3c4d5e6f.${i.toString(16).padStart(16, "0")}`);
const objPg = (name: string) => hash(name) % PG_NUM;
const pgName = (pg: number) => `${POOL_ID}.${pg.toString(16)}`;
const hostName = (h: number) => `pve${h + 1}`;

function build(hosts: number, size: number): Sim {
  const osds: Osd[] = [];
  for (let h = 0; h < hosts; h++)
    for (let k = 0; k < OSD_PER_HOST; k++) osds.push({ id: h * OSD_PER_HOST + k, host: h, up: true, in: true, downAt: null });
  const pgs = Array.from({ length: PG_NUM }, (_, pg) => ({ have: crush(pg, osds, size), bf: {} }));
  return { t: 0, osds, pgs, hostDown: Array(hosts).fill(false), log: [{ t: 0, msg: `pool vm-pool: size ${size}, ${PG_NUM} PGs, all active+clean`, tone: "ok" }], wasClean: true };
}

function classify(pg: Pg, idx: number, osds: Osd[], size: number, minSize: number) {
  const targets = crush(idx, osds, size);
  const upTargets = targets.filter((o) => osds[o].up);
  const live = pg.have.filter((o) => osds[o].up);
  const missing = upTargets.filter((o) => !pg.have.includes(o));
  let kind: Kind;
  if (live.length === 0) kind = "stale";
  else if (live.length < minSize) kind = "peered";
  else if (missing.length > 0) kind = "backfill";
  else if (live.length < size) kind = "degraded";
  else kind = "clean";
  // while backfilling, Ceph keeps serving from the OSDs that have the data (pg_temp)
  const acting = missing.length > 0 ? live : upTargets;
  const label =
    kind === "backfill" && live.length < size ? "active+undersized+degraded+remapped+backfilling" : KIND_STYLE[kind].label;
  return { kind, label, targets, upTargets, live, missing, acting };
}

function monsUp(s: Sim) {
  return [0, 1, 2].filter((h) => h < s.hostDown.length && !s.hostDown[h]).length;
}

function step(s: Sim, dt: number, size: number, minSize: number, noout: boolean): Sim {
  const t = s.t + dt;
  const log = [...s.log];
  const quorum = monsUp(s) >= 2;
  const osds = s.osds.map((o) => {
    if (!o.up && o.in && !noout && quorum && o.downAt !== null && t - o.downAt >= OUT_AFTER) {
      log.push({ t, msg: `osd.${o.id} marked out after ${OUT_AFTER}s down → CRUSH remaps its PGs`, tone: "warn" });
      return { ...o, in: false };
    }
    return o;
  });

  const busy = new Set<number>();
  for (const pg of s.pgs) for (const k of Object.keys(pg.bf)) busy.add(Number(k));

  let finished = 0;
  const pgs = s.pgs.map((pg, idx) => {
    const targets = crush(idx, osds, size);
    const upTargets = targets.filter((o) => osds[o].up);
    const live = pg.have.filter((o) => osds[o].up);
    let have = [...pg.have];
    const bf: Record<number, number> = {};
    if (live.length > 0) {
      for (const o of upTargets) {
        if (have.includes(o)) continue;
        if (o in pg.bf) {
          const p = pg.bf[o] + BF_STEP;
          if (p >= 1) {
            have.push(o);
            finished++;
          } else bf[o] = p;
        } else if (!busy.has(o)) {
          busy.add(o); // osd_max_backfills = 1: one backfill into each OSD at a time
          bf[o] = 0;
        }
      }
    }
    if (upTargets.every((o) => have.includes(o))) {
      // all mapped OSDs have the data: drop copies on OSDs CRUSH no longer maps to
      have = have.filter((o) => targets.includes(o));
    }
    return { have, bf };
  });

  const allClean = pgs.every((pg, idx) => classify(pg, idx, osds, size, minSize).kind === "clean");
  if (finished > 0 && allClean && !s.wasClean) log.push({ t, msg: "recovery complete: all PGs active+clean", tone: "ok" });
  return { ...s, t, osds, pgs, log: log.slice(-7), wasClean: allClean };
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function CephSim() {
  const [hosts, setHosts] = useState(4);
  const [size, setSize] = useState(3);
  const [minSize, setMinSize] = useState(2);
  const [noout, setNoout] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [running, setRunning] = useState(true);
  const [sim, setSim] = useState<Sim>(() => build(4, 3));
  const [sel, setSel] = useState<number | null>(null);

  const params = useRef({ size, minSize, noout, speed });
  useEffect(() => {
    params.current = { size, minSize, noout, speed };
  }, [size, minSize, noout, speed]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const p = params.current;
      setSim((s) => step(s, (p.speed * TICK_MS) / 1000, p.size, p.minSize, p.noout));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  const reset = (h = hosts) => {
    setSim(build(h, size));
    setSel(null);
  };

  const info = useMemo(() => sim.pgs.map((pg, i) => classify(pg, i, sim.osds, size, minSize)), [sim, size, minSize]);
  const counts = useMemo(() => {
    const c = new Map<Kind, number>();
    info.forEach((x) => c.set(x.kind, (c.get(x.kind) ?? 0) + 1));
    return c;
  }, [info]);
  const labelCounts = useMemo(() => {
    const c = new Map<string, { n: number; kind: Kind }>();
    info.forEach((x) => c.set(x.label, { n: (c.get(x.label)?.n ?? 0) + 1, kind: x.kind }));
    return [...c.entries()];
  }, [info]);

  const toggleOsd = (id: number) =>
    setSim((s) => {
      const o = s.osds[id];
      const osds = s.osds.map((x) => (x.id === id ? (o.up ? { ...x, up: false, downAt: s.t } : { ...x, up: true, in: true, downAt: null }) : x));
      const hostDown = [...s.hostDown];
      if (o.up === false) hostDown[o.host] = false;
      const msg = o.up ? `osd.${id} down (missed heartbeats); its PGs are now degraded` : `osd.${id} boot → up, in`;
      return { ...s, osds, hostDown, log: [...s.log, { t: s.t, msg, tone: o.up ? ("bad" as const) : ("info" as const) }].slice(-7), wasClean: false };
    });

  const toggleHost = (h: number) =>
    setSim((s) => {
      const down = !s.hostDown[h];
      const osds = s.osds.map((x) => (x.host !== h ? x : down ? (x.up ? { ...x, up: false, downAt: s.t } : x) : { ...x, up: true, in: true, downAt: null }));
      const hostDown = s.hostDown.map((d, i) => (i === h ? down : d));
      const msg = down ? `host ${hostName(h)} lost: ${OSD_PER_HOST} OSDs${h < 3 ? `, mon.${hostName(h)}` : ""} down` : `host ${hostName(h)} back`;
      return { ...s, osds, hostDown, log: [...s.log, { t: s.t, msg, tone: down ? ("bad" as const) : ("info" as const) }].slice(-7), wasClean: false };
    });

  const skip = () => setSim((s) => step(s, OUT_AFTER, size, minSize, noout));

  // --- geometry for backfill arrows -------------------------------------------------
  const wrap = useRef<HTMLDivElement>(null);
  const osdEls = useRef(new Map<number, HTMLElement>());
  const [pos, setPos] = useState<Record<number, { x: number; y: number }>>({});
  const measure = useCallback(() => {
    const root = wrap.current?.getBoundingClientRect();
    if (!root) return;
    const next: Record<number, { x: number; y: number }> = {};
    osdEls.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      next[id] = { x: r.left - root.left + r.width / 2, y: r.top - root.top + r.height / 2 };
    });
    setPos(next);
  }, []);
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, hosts]);

  const flows = useMemo(() => {
    const seen = new Set<string>();
    const out: { from: number; to: number; p: number }[] = [];
    sim.pgs.forEach((pg, i) => {
      const src = info[i].live[0];
      if (src === undefined) return;
      for (const [k, p] of Object.entries(pg.bf)) {
        const key = `${src}-${k}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from: src, to: Number(k), p });
      }
    });
    return out;
  }, [sim, info]);

  const selInfo = sel !== null ? info[sel] : null;
  const pgsOn = (id: number) => sim.pgs.filter((pg) => pg.have.includes(id)).length;
  const blocked = (counts.get("peered") ?? 0) + (counts.get("stale") ?? 0);
  const degraded = (counts.get("degraded") ?? 0) + (counts.get("backfill") ?? 0);
  const quorum = monsUp(sim);
  const health = blocked > 0 || quorum < 2 ? "HEALTH_WARN" : degraded > 0 || sim.osds.some((o) => !o.up) || noout ? "HEALTH_WARN" : "HEALTH_OK";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          hosts
          <Segmented
            value={String(hosts)}
            options={["3", "4", "5"]}
            onChange={(v) => {
              setHosts(Number(v));
              reset(Number(v));
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          size
          <Segmented value={String(size)} options={["2", "3"]} onChange={(v) => setSize(Number(v))} />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          min_size
          <Segmented value={String(minSize)} options={["1", "2"]} onChange={(v) => setMinSize(Number(v))} />
        </label>
        <Toggle checked={noout} onChange={setNoout} label={<span className="font-mono text-xs">noout</span>} />
        <label className="flex items-center gap-2 text-xs text-muted">
          speed
          <Segmented value={String(speed)} options={[{ value: "10", label: "10×" }, { value: "60", label: "60×" }, { value: "300", label: "300×" }]} onChange={(v) => setSpeed(Number(v))} />
        </label>
        <div className="flex gap-1.5">
          <Button onClick={() => setRunning((r) => !r)}>{running ? "pause" : "play"}</Button>
          <Button onClick={skip}>+10 min</Button>
          <Button variant="ghost" onClick={() => reset()}>
            reset
          </Button>
        </div>
      </div>

      {minSize === 1 && (
        <Callout tone="bad" title="min_size 1: the cluster will accept writes with a single copy">
          If that last OSD then dies, or comes back with writes the others never saw, those writes are gone. Ceph and Proxmox default to size 3 /
          min_size 2 so that every acknowledged write exists on at least two hosts.
        </Callout>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[11px]">
        <span className={clsx("font-semibold", health === "HEALTH_OK" ? "text-ok" : blocked ? "text-bad" : "text-warn")}>{health}</span>
        <span className="text-faint">t+{fmt(sim.t)}</span>
        <span className="text-muted">
          osd: {sim.osds.filter((o) => o.up).length} up, {sim.osds.filter((o) => o.in).length} in / {sim.osds.length}
        </span>
        <span className={quorum >= 2 ? "text-muted" : "text-bad"}>mon quorum {quorum}/3</span>
        {noout && <span className="text-warn">noout flag set</span>}
        {blocked > 0 && <span className="text-bad">Reduced data availability: {blocked} pgs inactive</span>}
        {degraded > 0 && <span className="text-warn">Degraded data redundancy: {degraded} pgs</span>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* hosts and OSDs */}
        <div ref={wrap} className="relative">
          <div className={clsx("grid gap-2", hosts === 3 ? "grid-cols-3" : hosts === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3 sm:grid-cols-5")}>
            {Array.from({ length: hosts }, (_, h) => {
              const hostOsds = sim.osds.filter((o) => o.host === h);
              const down = sim.hostDown[h];
              return (
                <div key={h} className={clsx("rounded-xl border p-2 transition", down ? "border-bad/60 bg-bad/5" : "border-line bg-panel-2/40")}>
                  <button
                    type="button"
                    onClick={() => toggleHost(h)}
                    className="mb-2 flex w-full items-center justify-between rounded px-1 text-left font-mono text-xs hover:bg-panel-2"
                    aria-label={`${down ? "restore" : "fail"} host ${hostName(h)}`}
                  >
                    <span className={down ? "text-bad line-through" : "text-ink"}>{hostName(h)}</span>
                    <span className="text-[9px] text-faint">{down ? "revive" : "fail host"}</span>
                  </button>
                  <div className="mb-2 flex gap-1 px-1">
                    {h < 3 && <span className={clsx("rounded px-1 font-mono text-[9px]", down ? "bg-bad/20 text-bad" : "bg-f4/20 text-f4")}>mon</span>}
                    {h < 2 && (
                      <span className={clsx("rounded px-1 font-mono text-[9px]", down ? "bg-bad/20 text-bad" : "bg-f6/20 text-f6")}>
                        mgr{h === 0 ? "" : "·sb"}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {hostOsds.map((o) => {
                      const n = pgsOn(o.id);
                      const isTarget = selInfo?.targets.includes(o.id);
                      const isPrimary = selInfo?.acting[0] === o.id;
                      const filling = sim.pgs.some((pg) => o.id in pg.bf);
                      const left = o.downAt !== null && o.in ? Math.max(0, OUT_AFTER - (sim.t - o.downAt)) : 0;
                      return (
                        <button
                          key={o.id}
                          ref={(el) => {
                            if (el) osdEls.current.set(o.id, el);
                            else osdEls.current.delete(o.id);
                          }}
                          type="button"
                          onClick={() => toggleOsd(o.id)}
                          aria-label={`osd.${o.id} ${o.up ? "up" : "down"} ${o.in ? "in" : "out"}; click to ${o.up ? "fail" : "revive"}`}
                          className={clsx(
                            "relative block w-full rounded-lg border px-2 py-1.5 text-left transition",
                            !o.up && o.in && "border-warn/70 bg-warn/10",
                            !o.up && !o.in && "border-bad/60 bg-bad/10 opacity-70",
                            o.up && !filling && "border-line bg-bg hover:border-faint",
                            o.up && filling && "animate-pulse-soft border-info bg-info/10",
                            isTarget && "ring-2 ring-accent",
                          )}
                        >
                          <div className="flex items-center justify-between font-mono text-[11px]">
                            <span className={o.up ? "text-ink" : "text-muted"}>osd.{o.id}</span>
                            {isPrimary && <span className="rounded bg-accent px-1 text-[9px] text-black">primary</span>}
                          </div>
                          <div className="font-mono text-[9px] text-faint">
                            {o.up ? (o.in ? "up · in" : "up · out") : o.in ? (noout ? "down · in (noout)" : `down · out in ${Math.ceil(left)}s`) : "down · out"}
                          </div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-2">
                            <div className="h-full bg-f1/70 transition-all duration-300" style={{ width: `${Math.min(100, (n / ((PG_NUM * size) / sim.osds.length)) * 50)}%` }} />
                          </div>
                          <div className="mt-0.5 font-mono text-[9px] text-faint">{n} PG copies</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {/* backfill traffic */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {flows.map((f) => {
              const a = pos[f.from];
              const b = pos[f.to];
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2;
              const my = Math.min(a.y, b.y) - 40;
              const d = `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
              return (
                <g key={`${f.from}-${f.to}`}>
                  <path d={d} fill="none" stroke="var(--color-info)" strokeWidth={1.5} strokeDasharray="6 6" className="animate-dash" opacity={0.8} />
                  <circle r={3.5} fill="var(--color-info)">
                    <animateMotion dur="1.1s" repeatCount="indefinite" path={d} />
                  </circle>
                </g>
              );
            })}
          </svg>
        </div>

        {/* PGs, objects, log */}
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] tracking-wide text-faint uppercase">
              <span>pool vm-pool · {PG_NUM} placement groups</span>
              <span className="normal-case">click one</span>
            </div>
            <div className="grid grid-cols-8 gap-1">
              {info.map((x, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSel(sel === i ? null : i)}
                  title={`pg ${pgName(i)}: ${x.label}`}
                  aria-label={`pg ${pgName(i)} ${x.label}`}
                  className={clsx(
                    "h-7 rounded font-mono text-[9px] text-black/70 transition-colors duration-300",
                    KIND_STYLE[x.kind].bg,
                    sel === i && "ring-2 ring-ink",
                    x.kind === "backfill" && "animate-pulse-soft",
                  )}
                >
                  {pgName(i)}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
              {labelCounts.map(([label, { n, kind }]) => (
                <span key={label} className={KIND_STYLE[kind].text}>
                  {n} {label}
                </span>
              ))}
            </div>
          </div>

          {selInfo && sel !== null ? (
            <div className="animate-rise rounded-lg border border-line bg-bg p-2.5 font-mono text-[11px] leading-relaxed">
              <div>
                pg <span className="text-accent">{pgName(sel)}</span> <span className={KIND_STYLE[selInfo.kind].text}>{selInfo.label}</span>
              </div>
              <div className="text-muted">
                up [{selInfo.upTargets.map((o) => `osd.${o}`).join(", ")}] · acting [{selInfo.acting.map((o) => `osd.${o}`).join(", ")}]
              </div>
              <div className="text-faint">
                hosts {selInfo.targets.map((o) => hostName(sim.osds[o].host)).join(", ")} · copies reachable {selInfo.live.length}/{size}
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-1.5 text-[11px] tracking-wide text-faint uppercase">vm-100-disk-0 → 4 MiB objects → PG</div>
              <ul className="space-y-0.5 font-mono text-[10px]">
                {OBJECTS.slice(0, 5).map((o) => (
                  <li key={o}>
                    <button type="button" className="text-left text-muted hover:text-ink" onClick={() => setSel(objPg(o))}>
                      {o} <span className="text-faint">→ hash mod {PG_NUM} →</span> <span className="text-accent">pg {pgName(objPg(o))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-line bg-bg p-2.5">
            <div className="mb-1 font-mono text-[10px] text-faint">ceph -w</div>
            <ul className="space-y-0.5 font-mono text-[10.5px]">
              {sim.log.map((l, i) => (
                <li
                  key={`${l.t}-${i}-${l.msg}`}
                  className={clsx("animate-rise", l.tone === "bad" && "text-bad", l.tone === "warn" && "text-warn", l.tone === "ok" && "text-ok", l.tone === "info" && "text-info")}
                >
                  <span className="text-faint">{fmt(l.t)}</span> {l.msg}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <Hint hosts={hosts} size={size} downHosts={sim.hostDown.filter(Boolean).length} blocked={blocked} />
    </div>
  );
}

function Hint({ hosts, size, downHosts, blocked }: { hosts: number; size: number; downHosts: number; blocked: number }) {
  if (blocked > 0)
    return (
      <Callout tone="bad" title="Some PGs have fewer than min_size copies reachable: I/O to them stops">
        Any VM with an object in those PGs hangs on that I/O until a copy comes back. Ceph chooses to block rather than accept writes it cannot
        replicate. Revive an OSD or host and watch them go active again.
      </Callout>
    );
  if (downHosts > 0 && hosts - downHosts < size)
    return (
      <Callout tone="warn" title={`Only ${hosts - downHosts} hosts left for size ${size} with failure domain = host`}>
        CRUSH cannot place a third copy on a host that already has one, so after the OSDs are marked out the PGs stay{" "}
        <code>undersized+degraded</code> instead of healing. That is why a 3-node cluster survives losing a node but cannot self-heal; with 4+
        nodes it re-replicates onto the survivors.
      </Callout>
    );
  return (
    <p className="text-xs leading-relaxed text-muted">
      Try it: fail one OSD and watch its PGs turn degraded. Nothing moves for {OUT_AFTER / 60} minutes (a reboot should not trigger a rebalance);
      then the OSD is marked <em>out</em>, CRUSH maps its PGs elsewhere and backfill copies the data (blue arrows). Fail a whole host, set{" "}
      <code>noout</code> for maintenance, or drop to 3 hosts and compare.
    </p>
  );
}

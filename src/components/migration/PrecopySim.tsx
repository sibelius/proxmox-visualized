"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button, Panel, Segmented, Slider, Stat, Toggle } from "@/components/ui";

const N = 256; // cells shown (each one stands for RAM/256)
const SUB = 64; // dirty-tracking granularity inside a cell
const MAX_DOWNTIME = 0.1; // seconds: qm option migrate_downtime, default 0.1
const WALL_FIRST_ROUND = 4; // wall seconds the first full copy takes on screen

type Phase = "idle" | "precopy" | "stopcopy" | "done" | "stuck";
type PageState = 0 | 1 | 2; // 0 = queued this round, 1 = on target & clean, 2 = dirtied after copy (dirty[] says how much)
type Round = { n: number; sentMiB: number; dirtyMiB: number; throttle: number };

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function PrecopySim() {
  const [ram, setRam] = useState("8");
  const [link, setLink] = useState("10");
  const [dirty, setDirty] = useState(300);
  const [wss, setWss] = useState(25);
  const [autoConverge, setAutoConverge] = useState(true);
  const [, setFrame] = useState(0);

  const ramMiB = Number(ram) * 1024;
  const bw = Number(link) * 112; // MiB/s effective
  const pageMiB = ramMiB / N;

  const s = useRef({
    phase: "idle" as Phase,
    pages: new Array<PageState>(N).fill(0),
    dirty: new Array<number>(N).fill(SUB),
    queue: [] as number[],
    hot: [] as number[],
    sendAcc: 0,
    dirtyAcc: 0,
    t: 0,
    round: 0,
    roundSent: 0,
    roundDirty: 0,
    totalSent: 0,
    throttle: 0,
    highCnt: 0,
    rounds: [] as Round[],
    downtime: 0,
    stopStart: 0,
    rnd: mulberry(7),
  });
  const params = useRef({ bw, dirty, autoConverge, pageMiB, ramMiB });
  params.current = { bw, dirty, autoConverge, pageMiB, ramMiB };

  const reset = useCallback(
    (start = false) => {
      const st = s.current;
      st.rnd = mulberry(7);
      const idx = Array.from({ length: N }, (_, i) => i);
      for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(st.rnd() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      st.hot = idx.slice(0, Math.max(1, Math.round((wss / 100) * N)));
      st.pages = new Array<PageState>(N).fill(0);
      st.dirty = new Array<number>(N).fill(SUB);
      st.queue = Array.from({ length: N }, (_, i) => i);
      Object.assign(st, { sendAcc: 0, dirtyAcc: 0, t: 0, round: 1, roundSent: 0, roundDirty: 0, totalSent: 0, throttle: 0, highCnt: 0, rounds: [], downtime: 0, stopStart: 0 });
      st.phase = start ? "precopy" : "idle";
      setFrame((f) => f + 1);
    },
    [wss],
  );

  useEffect(() => reset(false), [ram, wss, reset]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const st = s.current;
      const p = params.current;
      const dtWall = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (st.phase === "precopy" || st.phase === "stopcopy") {
        const scale = p.ramMiB / p.bw / WALL_FIRST_ROUND;
        const dt = dtWall * scale;
        st.t += dt;
        const subMiB = p.pageMiB / SUB;
        // 1) send the queued cells in bitmap order; a cell costs only its dirty sub-pages
        st.sendAcc += (p.bw / subMiB) * dt;
        while (st.queue.length && st.sendAcc >= st.dirty[st.queue[0]]) {
          const pg = st.queue.shift()!;
          st.sendAcc -= st.dirty[pg];
          st.roundSent += st.dirty[pg];
          st.totalSent += st.dirty[pg];
          st.dirty[pg] = 0;
          st.pages[pg] = 1;
        }
        if (!st.queue.length) st.sendAcc = 0;
        // 2) the running guest dirties memory inside its working set
        if (st.phase === "precopy") {
          st.dirtyAcc += ((p.dirty * (1 - st.throttle / 100)) / subMiB) * dt;
          let k = Math.floor(st.dirtyAcc);
          st.dirtyAcc -= k;
          while (k-- > 0) {
            const pg = st.hot[Math.floor(st.rnd() * st.hot.length)];
            // writing an already-dirty sub-page again costs nothing extra
            if (st.dirty[pg] < SUB && st.rnd() >= st.dirty[pg] / SUB) {
              st.dirty[pg] += 1;
              if (st.pages[pg] !== 0) {
                st.pages[pg] = 2;
                st.roundDirty += 1;
              }
            }
          }
        }
        // 3) end of an iteration: sync the dirty bitmap and decide
        if (!st.queue.length) {
          if (st.phase === "stopcopy") {
            st.phase = "done"; // downtime was computed exactly when the guest paused
          } else {
            const remaining = st.dirty.reduce((a, x) => a + x, 0);
            st.rounds.push({ n: st.round, sentMiB: st.roundSent * subMiB, dirtyMiB: remaining * subMiB, throttle: st.throttle });
            const est = (remaining * subMiB) / p.bw;
            const next = st.pages.map((x, i) => (x === 2 ? i : -1)).filter((i) => i >= 0);
            if (est <= MAX_DOWNTIME) {
              st.phase = "stopcopy"; // pause vCPUs, send the rest, hand over
              st.stopStart = st.t;
              st.downtime = est;
              next.forEach((i) => (st.pages[i] = 0));
              st.queue = next;
              if (!next.length) st.phase = "done";
            } else {
              // QEMU auto-converge: if the guest dirtied more than half of what we sent, twice, throttle the vCPUs harder
              if (p.autoConverge && st.round >= 2 && st.roundDirty > 0.5 * st.roundSent) {
                st.highCnt += 1;
                if (st.highCnt >= 2) {
                  st.throttle = st.throttle ? Math.min(99, st.throttle + 10) : 20;
                  st.highCnt = 0;
                }
              }
              if (st.round >= 40) st.phase = "stuck";
              else {
                next.forEach((i) => (st.pages[i] = 0));
                st.queue = next;
                st.round += 1;
                st.roundSent = 0;
                st.roundDirty = 0;
              }
            }
          }
        }
        setFrame((f) => (f + 1) % 1e6);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const st = s.current;
  const remainingPages = st.pages.reduce<number>((a, x) => a + (x !== 1 ? 1 : 0), 0);
  const dirtyMiB = (st.dirty.reduce((a, x, i) => a + (st.pages[i] === 2 ? x : 0), 0) * pageMiB) / SUB;
  const estDowntimeMs = (dirtyMiB / bw) * 1000;
  const effDirty = dirty * (1 - st.throttle / 100);
  const maxBar = Math.max(1, ...st.rounds.map((r) => r.sentMiB));

  return (
    <Panel
      title="Pre-copy live migration"
      right={
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => reset(true)}>
            ▶ {st.phase === "idle" ? "qm migrate --online" : "restart"}
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-faint">VM RAM</span>
          <Segmented value={ram} onChange={setRam} options={[{ value: "4", label: "4 GiB" }, { value: "8", label: "8 GiB" }, { value: "32", label: "32 GiB" }, { value: "128", label: "128 GiB" }]} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-faint">migration link</span>
          <Segmented value={link} onChange={setLink} options={[{ value: "1", label: "1 GbE" }, { value: "10", label: "10 GbE" }, { value: "25", label: "25 GbE" }]} />
        </div>
        <Slider label="guest dirty rate" value={dirty} min={0} max={3000} step={25} onChange={setDirty} format={(v) => `${v} MiB/s`} />
        <Slider label="working set" value={wss} min={5} max={100} step={5} onChange={setWss} format={(v) => `${v}%`} />
        <Toggle checked={autoConverge} onChange={setAutoConverge} label="auto-converge" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="mx-auto mb-2 flex max-w-[420px] items-center justify-between gap-2 text-[11px] text-faint">
            <span>guest RAM on source · 1 cell = {pageMiB >= 1024 ? `${pageMiB / 1024} GiB` : `${pageMiB} MiB`}</span>
            <span className={clsx("font-mono", st.phase === "stopcopy" ? "text-warn" : st.phase === "done" ? "text-ok" : "text-muted")}>
              {st.phase === "stopcopy" ? "vCPUs PAUSED" : st.phase === "done" ? "running on target" : st.phase === "idle" ? "running on source" : "running on source"}
            </span>
          </div>
          <div
            className={clsx("mx-auto grid max-w-[420px] gap-[2px] rounded-lg border p-2 transition", st.phase === "stopcopy" ? "border-warn" : "border-line")}
            style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
            role="img"
            aria-label={`RAM pages: ${remainingPages} of ${N} still to send`}
          >
            {st.pages.map((x, i) => (
              <div
                key={i}
                className="aspect-square rounded-[2px]"
                style={{
                  background:
                    x === 1
                      ? "color-mix(in srgb, var(--color-ok) 55%, transparent)"
                      : x === 2
                        ? `color-mix(in srgb, var(--color-accent) ${Math.round(40 + (60 * st.dirty[i]) / SUB)}%, transparent)`
                        : "var(--color-panel-2)",
                  outline: st.hot.includes(i) && st.phase !== "done" ? "1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)" : undefined,
                }}
              />
            ))}
          </div>
          <div className="mx-auto mt-2 flex max-w-[420px] flex-wrap gap-3 text-[11px] text-muted">
            <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-panel-2 ring-1 ring-line" /> to send this round</span>
            <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-ok/60" /> copied, clean</span>
            <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-accent" /> dirtied after copy</span>
            <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm ring-1 ring-accent/30" /> working set</span>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="iteration" value={st.phase === "idle" ? "–" : st.round} />
            <Stat label="elapsed" value={`${st.t.toFixed(1)} s`} />
            <Stat label="sent" value={`${((st.totalSent * pageMiB) / SUB / 1024).toFixed(1)} GiB`} />
            <Stat label="est. downtime" value={st.phase === "idle" ? "–" : `${Math.round(estDowntimeMs)} ms`} tone={estDowntimeMs <= MAX_DOWNTIME * 1000 ? "good" : "warn"} />
            <Stat label="vCPU throttle" value={`${st.throttle}%`} tone={st.throttle ? "warn" : "neutral"} />
            <Stat
              label={st.phase === "done" ? "actual downtime" : "dirty vs link"}
              value={st.phase === "done" ? `${Math.round(st.downtime * 1000)} ms` : `${Math.round(effDirty)} / ${bw}`}
              tone={st.phase === "done" ? "good" : effDirty >= bw ? "bad" : "neutral"}
            />
          </div>

          <div>
            <div className="mb-1 text-[11px] text-faint">MiB sent per iteration (should shrink)</div>
            <svg viewBox="0 0 300 90" className="h-24 w-full rounded-lg border border-line bg-bg" preserveAspectRatio="none" role="img" aria-label="Bytes sent per iteration">
              {st.rounds.slice(-30).map((r, i) => {
                const h = Math.max(1, (r.sentMiB / maxBar) * 80);
                return <rect key={r.n} x={4 + i * 9.8} y={86 - h} width={7.5} height={h} fill={r.throttle ? "var(--color-warn)" : "var(--color-info)"} opacity={0.85} />;
              })}
              <line x1={0} x2={300} y1={86 - ((bw * MAX_DOWNTIME) / maxBar) * 80} y2={86 - ((bw * MAX_DOWNTIME) / maxBar) * 80} stroke="var(--color-ok)" strokeDasharray="3 3" />
            </svg>
            <div className="mt-1 text-[10px] text-faint">dashed: what fits in {MAX_DOWNTIME * 1000} ms of downtime · amber bars: vCPUs throttled</div>
          </div>

          <Verdict phase={st.phase} round={st.round} dirtyHigh={effDirty >= bw} autoConverge={autoConverge} throttle={st.throttle} />
        </div>
      </div>
    </Panel>
  );
}

function Verdict({ phase, round, dirtyHigh, autoConverge, throttle }: { phase: Phase; round: number; dirtyHigh: boolean; autoConverge: boolean; throttle: number }) {
  let tone = "border-line text-muted";
  let text: ReactNode = "Press ▶. The first iteration copies all of RAM while the guest keeps running and keeps writing.";
  if (phase === "precopy") {
    text =
      round === 1
        ? "Iteration 1: copying all RAM. Every page the guest writes after it was copied turns orange and must be sent again."
        : `Iteration ${round}: only pages dirtied during the previous iteration are re-sent.${dirtyHigh ? " The guest dirties memory faster than the link drains it…" : ""}`;
    if (throttle) text = <>{text} Auto-converge is stealing CPU time from the guest ({throttle}%) so it dirties less.</>;
  }
  if (phase === "stopcopy") {
    tone = "border-warn/50 text-warn";
    text = "Converged: the rest fits in the downtime budget. vCPUs pause, last dirty pages + device state are sent, the target resumes.";
  }
  if (phase === "done") {
    tone = "border-ok/50 text-ok";
    text = "Switchover done: the VM runs on the target; the source QEMU is stopped. The guest saw one short pause.";
  }
  if (phase === "stuck") {
    tone = "border-bad/50 text-bad";
    text = autoConverge
      ? "Still not converging after 40 iterations."
      : "Not converging: every iteration re-sends the same hot working set. Without throttling this runs forever. Turn on auto-converge, lower the dirty rate or use a faster link. (Proxmox also raises the allowed downtime step by step when it sees no progress.)";
  }
  return <div className={clsx("rounded-lg border px-3 py-2 text-xs leading-relaxed", tone)}>{text}</div>;
}

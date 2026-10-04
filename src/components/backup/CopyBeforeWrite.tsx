"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button, Panel, Stat, Toggle } from "@/components/ui";

const N = 32;
const VCOL = ["var(--color-f1)", "var(--color-f3)", "var(--color-f5)", "var(--color-f2)", "var(--color-f4)", "var(--color-f6)"];

type Blk = { ver: number; saved: number | null; flash: number; cbw: boolean };
const fresh = (): Blk[] => Array.from({ length: N }, () => ({ ver: 0, saved: null, flash: 0, cbw: false }));

export function CopyBeforeWrite() {
  const [blocks, setBlocks] = useState<Blk[]>(fresh);
  const [cursor, setCursor] = useState(-1); // -1 = not started; N = done
  const [auto, setAuto] = useState(true);
  const [fleecing, setFleecing] = useState(false);
  const [stats, setStats] = useState({ writes: 0, cbw: 0, stallMs: 0 });
  const [msg, setMsg] = useState<string>("Press ▶ to start a snapshot-mode backup, then click blocks to make the guest write.");
  const tick = useRef(0);

  const running = cursor >= 0 && cursor < N;

  // the backup job reads the disk front to back
  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => {
      setBlocks((bs) => bs.map((b, i) => (i === cursor && b.saved === null ? { ...b, saved: b.ver } : b)));
      setCursor((c) => c + 1);
    }, 380);
    return () => clearTimeout(id);
  }, [cursor, running]);

  useEffect(() => {
    if (cursor === N) setMsg("Backup finished. Every block in the backup has version v0: the disk exactly as it was when the job started, even though the guest kept writing.");
  }, [cursor]);

  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const write = (i: number) => {
    tick.current += 1;
    const b = blocksRef.current[i];
    const c = cursorRef.current;
    const live = c >= 0 && c < N;
    const needsCbw = live && b.saved === null;
    const next = [...blocksRef.current];
    next[i] = { ver: b.ver + 1, saved: needsCbw ? b.ver : b.saved, flash: tick.current, cbw: b.cbw || needsCbw };
    blocksRef.current = next;
    setBlocks(next);
    if (needsCbw) {
      const stall = fleecing ? 1 : 25;
      setStats((s) => ({ writes: s.writes + 1, cbw: s.cbw + 1, stallMs: s.stallMs + stall }));
      setMsg(
        fleecing
          ? `Guest wrote block ${i} before the job reached it. The old data was first copied to the local fleecing image (fast), then the write went through.`
          : `Guest wrote block ${i} before the job reached it. QEMU held that write, sent the OLD block to the backup target first, then let the write through.`,
      );
    } else {
      setStats((s) => ({ ...s, writes: s.writes + 1 }));
      if (live) setMsg(`Guest wrote block ${i}: already backed up, so the write goes straight to disk.`);
    }
  };

  useEffect(() => {
    if (!auto || !running) return;
    const id = setInterval(() => write(Math.floor(Math.random() * N)), 650);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, running, fleecing]);

  const start = () => {
    setBlocks((bs) => bs.map((b) => ({ ...b, saved: null, cbw: false, ver: 0 })));
    setStats({ writes: 0, cbw: 0, stallMs: 0 });
    setCursor(0);
    setMsg("Job started at t0. From now on, the backup must contain the disk as of t0.");
  };

  return (
    <Panel
      title="Snapshot mode without a snapshot: copy-before-write"
      right={
        <div className="flex flex-wrap items-center gap-3">
          <Toggle checked={auto} onChange={setAuto} label="guest writes randomly" />
          <Toggle checked={fleecing} onChange={setFleecing} label="fleecing" />
          <Button variant="primary" onClick={start}>▶ {cursor < 0 ? "start backup" : "again"}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Row title="live disk (what the guest sees) · click a block to write it">
          {blocks.map((b, i) => (
            <button
              key={i}
              type="button"
              onClick={() => write(i)}
              aria-label={`block ${i}, version ${b.ver}`}
              className={clsx("relative h-9 rounded-sm border font-mono text-[9px] transition hover:brightness-125", i === cursor && "ring-2 ring-accent")}
              style={{ background: `color-mix(in srgb, ${VCOL[b.ver % VCOL.length]} 30%, var(--color-bg))`, borderColor: VCOL[b.ver % VCOL.length] }}
            >
              <span key={b.flash} className={clsx("absolute inset-0 flex items-center justify-center rounded-sm text-ink", b.flash && "animate-flash")}>
                <span className="hidden sm:inline">v{b.ver}</span>
              </span>
            </button>
          ))}
        </Row>

        <div className="relative h-6">
          {cursor >= 0 && cursor < N && (
            <div className="absolute -top-1 -translate-x-1/2 text-center font-mono text-[10px] text-accent transition-all duration-300" style={{ left: `${((cursor + 0.5) / N) * 100}%` }}>
              ▲<br />job reads
            </div>
          )}
        </div>

        {fleecing && (
          <Row title="fleecing image on fast local storage (old blocks parked here)">
            {blocks.map((b, i) => (
              <div key={i} className="h-5 rounded-sm border border-line" style={{ background: b.cbw ? `color-mix(in srgb, ${VCOL[0]} 30%, var(--color-bg))` : "transparent" }} />
            ))}
          </Row>
        )}

        <Row title="backup on PBS (point-in-time = job start)">
          {blocks.map((b, i) => (
            <div
              key={i}
              className={clsx("relative flex h-9 items-center justify-center rounded-sm border font-mono text-[9px]", b.cbw && "ring-1 ring-warn")}
              style={
                b.saved === null
                  ? { borderColor: "var(--color-line)", borderStyle: "dashed" }
                  : { background: `color-mix(in srgb, ${VCOL[b.saved % VCOL.length]} 30%, var(--color-bg))`, borderColor: VCOL[b.saved % VCOL.length] }
              }
            >
              {b.saved !== null && <span className="hidden text-ink sm:inline">v{b.saved}</span>}
              {b.cbw && <span className="absolute -top-2 right-0 rounded bg-warn px-0.5 text-[7px] text-bg">CBW</span>}
            </div>
          ))}
        </Row>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <p key={msg} className="animate-rise text-sm leading-relaxed text-muted">{msg}</p>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="guest writes" value={stats.writes} />
          <Stat label="copy-before-write" value={stats.cbw} tone={stats.cbw ? "warn" : "neutral"} />
          <Stat label="write stall" value={`${stats.stallMs} ms`} tone={stats.stallMs > 100 ? "bad" : "neutral"} />
        </div>
      </div>
    </Panel>
  );
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-faint">{title}</div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))` }}>
        {children}
      </div>
    </div>
  );
}

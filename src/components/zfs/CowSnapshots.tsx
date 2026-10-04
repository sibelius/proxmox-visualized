"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Button, Stat } from "@/components/ui";

type Tree = { txg: number; root: string; ind: [string, string]; data: [string, string, string, string] };
type Snap = { name: string; tree: Tree };

const LETTERS = ["A", "B", "C", "D"];

const INITIAL: Tree = { txg: 1, root: "R·1", ind: ["L0·1", "L1·1"], data: ["A·1", "B·1", "C·1", "D·1"] };

function blocksOf(t: Tree) {
  return [t.root, ...t.ind, ...t.data];
}
function txgOf(id: string) {
  return Number(id.split("·")[1]);
}

const X = [70, 190, 310, 430];

export function CowSnapshots() {
  const [live, setLive] = useState<Tree>(INITIAL);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [freed, setFreed] = useState(0);
  const [last, setLast] = useState<string[]>([]);

  const liveSet = useMemo(() => new Set(blocksOf(live)), [live]);
  const snapSet = useMemo(() => new Set(snaps.flatMap((s) => blocksOf(s.tree))), [snaps]);
  const allocated = useMemo(() => {
    const all = new Set([...liveSet, ...snapSet]);
    return [...all].sort((a, b) => txgOf(a) - txgOf(b) || a.localeCompare(b));
  }, [liveSet, snapSet]);

  const countFreed = (before: Set<string>, after: Set<string>) => [...before].filter((b) => !after.has(b)).length;

  const write = (i: number) => {
    const txg = live.txg + 1;
    const d = [...live.data] as Tree["data"];
    d[i] = `${LETTERS[i]}·${txg}`;
    const ind = [...live.ind] as Tree["ind"];
    ind[i >> 1] = `L${i >> 1}·${txg}`;
    const next: Tree = { txg, root: `R·${txg}`, ind, data: d };
    const before = new Set([...liveSet, ...snapSet]);
    const after = new Set([...blocksOf(next), ...snapSet]);
    setFreed((f) => f + countFreed(before, after));
    setLive(next);
    setLast([d[i], ind[i >> 1], next.root]);
  };

  const snapshot = () => {
    setSnaps((s) => [...s, { name: `@snap${s.length ? Number(s[s.length - 1].name.slice(5)) + 1 : 1}`, tree: live }]);
    setLast([]);
  };

  const rollback = (idx: number) => {
    const target = snaps[idx];
    const keep = snaps.slice(0, idx + 1);
    const before = new Set([...liveSet, ...snapSet]);
    const after = new Set(keep.flatMap((s) => blocksOf(s.tree)));
    setFreed((f) => f + countFreed(before, after));
    // new txg, but the tree points at the snapshot's blocks
    setLive({ ...target.tree, txg: live.txg + 1 });
    setSnaps(keep);
    setLast([]);
  };

  const destroy = (idx: number) => {
    const keep = snaps.filter((_, i) => i !== idx);
    const before = new Set([...liveSet, ...snapSet]);
    const after = new Set([...liveSet, ...keep.flatMap((s) => blocksOf(s.tree))]);
    setFreed((f) => f + countFreed(before, after));
    setSnaps(keep);
    setLast([]);
  };

  const reset = () => {
    setLive(INITIAL);
    setSnaps([]);
    setFreed(0);
    setLast([]);
  };

  const snapOnly = allocated.filter((b) => !liveSet.has(b)).length;
  const shared = [...liveSet].filter((b) => snapSet.has(b)).length;

  const node = (id: string, x: number, y: number, kind: "root" | "ind" | "data", onClick?: () => void) => {
    const fresh = last.includes(id);
    const pinned = snapSet.has(id);
    const w = kind === "data" ? 64 : 76;
    return (
      <g
        key={id + x}
        transform={`translate(${x - w / 2},${y})`}
        onClick={onClick}
        className={clsx(onClick && "cursor-pointer")}
        role={onClick ? "button" : undefined}
        aria-label={onClick ? `overwrite block ${id.split("·")[0]}` : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      >
        <rect
          width={w}
          height={34}
          rx={7}
          fill={fresh ? "color-mix(in srgb, var(--color-accent) 22%, var(--color-panel-2))" : "var(--color-panel-2)"}
          stroke={fresh ? "var(--color-accent)" : pinned ? "var(--color-ok)" : "var(--color-line)"}
          strokeWidth={fresh || pinned ? 1.6 : 1}
          className="transition-all duration-300"
        />
        <text x={w / 2} y={15} textAnchor="middle" className="fill-ink font-mono text-[11px]">
          {kind === "root" ? "uberblock" : id.split("·")[0]}
        </text>
        <text x={w / 2} y={27} textAnchor="middle" className="fill-faint font-mono text-[9px]">
          txg {txgOf(id)}
        </text>
      </g>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Overwrite a block:</span>
        {LETTERS.map((l, i) => (
          <Button key={l} onClick={() => write(i)}>
            write {l}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <Button variant="primary" onClick={snapshot} disabled={snaps.length >= 4}>
          zfs snapshot
        </Button>
        <Button variant="ghost" onClick={reset}>
          reset
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-line bg-bg p-2">
          <div className="px-2 pt-1 font-mono text-[10px] text-faint uppercase">live tree · txg {live.txg}</div>
          <svg viewBox="0 0 500 220" className="w-full" role="img" aria-label="Copy-on-write block tree of the live dataset">
            {[0, 1].map((j) => (
              <line key={`r${j}`} x1={250} y1={44} x2={j ? 370 : 130} y2={92} stroke="var(--color-line)" strokeWidth={1.5} />
            ))}
            {[0, 1, 2, 3].map((i) => (
              <line key={`i${i}`} x1={i < 2 ? 130 : 370} y1={126} x2={X[i]} y2={170} stroke="var(--color-line)" strokeWidth={1.5} />
            ))}
            {node(live.root, 250, 10, "root")}
            {node(live.ind[0], 130, 92, "ind")}
            {node(live.ind[1], 370, 92, "ind")}
            {live.data.map((d, i) => node(d, X[i], 172, "data", () => write(i)))}
          </svg>
          <p className="px-2 pb-1 text-[11px] text-muted">
            Writes never overwrite in place: the new block goes to free space, then every parent up to the uberblock is rewritten to point at it.
            Click a data block to overwrite it.
          </p>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="snapshot-only" value={snapOnly} tone={snapOnly ? "warn" : "neutral"} />
            <Stat label="shared" value={shared} tone="good" />
            <Stat label="freed" value={freed} />
          </div>
          <div>
            <div className="mb-1.5 text-[11px] tracking-wide text-faint uppercase">allocated blocks on disk</div>
            <div className="flex flex-wrap gap-1">
              {allocated.map((b) => {
                const inLive = liveSet.has(b);
                const inSnap = snapSet.has(b);
                return (
                  <span
                    key={b}
                    className={clsx(
                      "animate-rise rounded border px-1.5 py-0.5 font-mono text-[10px]",
                      inLive && inSnap && "border-ok/50 bg-ok/10 text-ok",
                      inLive && !inSnap && "border-line bg-panel-2 text-muted",
                      !inLive && "border-warn/60 bg-warn/10 text-warn",
                    )}
                  >
                    {b.startsWith("R") ? "uber" : b.split("·")[0]}
                    <sub className="ml-0.5 text-[8px] opacity-70">{txgOf(b)}</sub>
                  </span>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-faint">
              <span className="text-muted">■ live only</span>
              <span className="text-ok">■ live + snapshot</span>
              <span className="text-warn">■ kept alive only by a snapshot</span>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] tracking-wide text-faint uppercase">snapshots</div>
            {snaps.length === 0 && <p className="text-xs text-faint">None yet. A snapshot just keeps the current uberblock&apos;s tree alive.</p>}
            <ul className="space-y-1.5">
              {snaps.map((s, i) => (
                <li key={s.name} className="flex animate-rise items-center justify-between gap-2 rounded-lg border border-line bg-panel-2/60 px-2.5 py-1.5">
                  <span className="font-mono text-xs">
                    tank/vm-100-disk-0<span className="text-accent">{s.name}</span>
                    <span className="ml-2 text-faint">txg {s.tree.txg}</span>
                  </span>
                  <span className="flex gap-1">
                    <Button variant="ghost" className="px-2! py-0.5! text-xs" onClick={() => rollback(i)}>
                      rollback{i < snaps.length - 1 ? " -r" : ""}
                    </Button>
                    <Button variant="danger" className="px-2! py-0.5! text-xs" onClick={() => destroy(i)}>
                      destroy
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

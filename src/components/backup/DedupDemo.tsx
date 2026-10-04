"use client";

import { useState } from "react";
import clsx from "clsx";
import { Button, Panel, Stat } from "@/components/ui";

const N = 16; // 16 × 4 MiB chunks = a 64 MiB "disk"
const MiB = 4;

type Snap = { id: number; day: number; chunks: string[]; read: number; uploaded: number; stored: number; full: boolean };
type Chunk = { atime: number };

/** SHA-256 stand-in: a short deterministic digest of the chunk's content. */
function digest(content: string) {
  let h = 2166136261;
  for (let i = 0; i < content.length; i++) h = Math.imul(h ^ content.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}
const hue = (d: string) => parseInt(d.slice(0, 4), 16) % 360;
const initialVers = () => Array.from({ length: N }, (_, i) => (i >= 12 ? -1 : 0)); // last 4 chunks are zeroes

function contentOf(i: number, ver: number) {
  return ver < 0 ? "zero" : `blk${i}v${ver}`; // all-zero chunks are identical -> one digest
}

export function DedupDemo() {
  const [vers, setVers] = useState<number[]>(initialVers);
  const [dirty, setDirty] = useState<boolean[]>(() => new Array(N).fill(true));
  const [bitmapValid, setBitmapValid] = useState(false);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [store, setStore] = useState<Record<string, Chunk>>({});
  const [day, setDay] = useState(1);
  const [log, setLog] = useState<string>("The VM has never been backed up. Press “backup” for the first, full run.");
  const [gcInfo, setGcInfo] = useState<{ removed: string[]; pending: string[] } | null>(null);

  const digests = vers.map((v, i) => digest(contentOf(i, v)));
  const referenced = new Set(snaps.flatMap((s) => s.chunks));

  const modify = (i: number) => {
    setVers((vs) => vs.map((v, k) => (k === i ? (v < 0 ? 1 : v + 1) : v)));
    setDirty((d) => d.map((x, k) => (k === i ? true : x)));
  };

  const backup = () => {
    const prev = snaps[snaps.length - 1];
    const known = new Set(prev?.chunks ?? []);
    const full = !bitmapValid || !prev;
    const toRead = full ? digests.map((_, i) => i) : digests.map((_, i) => i).filter((i) => dirty[i]);
    // client only uploads chunks not referenced by the previous snapshot's index
    const upload = [...new Set(toRead.map((i) => digests[i]).filter((d) => !known.has(d)))];
    const newlyStored = upload.filter((d) => !store[d]);
    setStore((st) => {
      const next = { ...st };
      for (const d of digests) next[d] = { atime: day };
      return next;
    });
    const snap: Snap = { id: (snaps.at(-1)?.id ?? 0) + 1, day, chunks: digests, read: toRead.length, uploaded: upload.length, stored: newlyStored.length, full };
    setSnaps((s) => [...s, snap]);
    setDirty(new Array(N).fill(false));
    setBitmapValid(true);
    setDay((d) => d + 1);
    setGcInfo(null);
    setLog(
      full
        ? !prev
          ? `Full backup: read all ${N} chunks (${N * MiB} MiB), hashed them, uploaded ${upload.length} unique ones. The four zero chunks share one digest.`
          : `Bitmap was gone: read all ${N} chunks again. But only ${upload.length} differ from the previous index, so only those were uploaded.`
        : `Incremental via dirty bitmap: read only ${toRead.length} chunk${toRead.length === 1 ? "" : "s"} (${toRead.length * MiB} MiB), uploaded ${upload.length}. The new index still lists all ${N}.`,
    );
  };

  const restartVm = () => {
    setBitmapValid(false);
    setLog("VM was stopped and started again: QEMU's in-memory dirty bitmap is gone. Next backup must read the whole disk again.");
  };

  const forget = (id: number) => {
    setSnaps((s) => s.filter((x) => x.id !== id));
    setGcInfo(null);
    setLog(`Pruned snapshot #${id}: only its index file is deleted. Its chunks stay on disk until garbage collection.`);
  };

  const gc = () => {
    // phase 1 (mark): touch every chunk referenced by any remaining index
    // phase 2 (sweep): delete chunks whose atime is older than the cutoff (~24 h before GC start)
    const removed: string[] = [];
    const pending: string[] = [];
    const next: Record<string, Chunk> = {};
    for (const [d, c] of Object.entries(store)) {
      if (referenced.has(d)) next[d] = { atime: day };
      else if (c.atime < day - 1) removed.push(d);
      else {
        pending.push(d);
        next[d] = c;
      }
    }
    setStore(next);
    setGcInfo({ removed, pending });
    setLog(
      `GC: marked ${referenced.size} referenced chunks (updated atime), swept ${removed.length}.` +
        (pending.length ? ` ${pending.length} unreferenced chunk(s) are younger than the 24 h cutoff and survive this run.` : ""),
    );
  };

  const reset = () => {
    setVers(initialVers());
    setDirty(new Array(N).fill(true));
    setBitmapValid(false);
    setSnaps([]);
    setStore({});
    setDay(1);
    setGcInfo(null);
    setLog("Reset.");
  };

  const storedMiB = Object.keys(store).length * MiB;
  const logicalMiB = snaps.length * N * MiB;

  return (
    <Panel
      title="PBS: fixed chunks, dirty bitmap, dedup, GC"
      right={
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={backup}>▶ backup (day {day})</Button>
          <Button onClick={restartVm}>restart VM</Button>
          <Button onClick={gc}>run GC</Button>
          <Button variant="ghost" onClick={reset}>↺</Button>
        </div>
      }
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-faint">
        <span>VM disk, 4 MiB chunks · click to let the guest change one</span>
        <span className={clsx("font-mono", bitmapValid ? "text-ok" : "text-warn")}>dirty bitmap: {bitmapValid ? "valid" : snaps.length ? "lost" : "none yet"}</span>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))` }}>
        {digests.map((d, i) => (
          <button
            key={i}
            type="button"
            onClick={() => modify(i)}
            aria-label={`chunk ${i}, digest ${d}${dirty[i] ? ", dirty" : ""}`}
            className={clsx("relative h-10 rounded border transition hover:brightness-125", dirty[i] && bitmapValid ? "border-accent ring-1 ring-accent" : "border-line")}
            style={{ background: vers[i] < 0 ? "var(--color-bg)" : `hsl(${hue(d)} 55% 45% / .55)` }}
          >
            <span className="absolute inset-x-0 bottom-0.5 hidden text-center font-mono text-[8px] text-ink/80 md:block">{d.slice(0, 4)}</span>
            {dirty[i] && bitmapValid && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      <div className="mt-5 mb-1 text-[11px] text-faint">snapshots on the datastore (each is just an index: a list of chunk digests)</div>
      <div className="space-y-1.5">
        {snaps.length === 0 && <div className="rounded border border-dashed border-line py-4 text-center text-xs text-faint">no backups yet</div>}
        {snaps.map((s) => (
          <div key={s.id} className="grid animate-rise grid-cols-[minmax(0,1fr)] items-center gap-2 sm:grid-cols-[220px_minmax(0,1fr)_170px]">
            <div className="font-mono text-[11px] text-muted">
              vm/100/day-{s.day} <span className="text-faint">drive-scsi0.img.fidx</span>
            </div>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))` }}>
              {s.chunks.map((d, i) => (
                <div key={i} title={d} className="h-4 rounded-sm" style={{ background: d === digest("zero") ? "var(--color-panel-2)" : `hsl(${hue(d)} 55% 45% / .55)` }} />
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 font-mono text-[10px] whitespace-nowrap text-faint">
              <span>
                read {s.read} · <span className="text-accent">up {s.uploaded}</span>
              </span>
              <button type="button" onClick={() => forget(s.id)} className="rounded px-1 text-muted hover:bg-bad/20 hover:text-bad" aria-label={`prune snapshot ${s.id}`}>
                prune ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 mb-1 text-[11px] text-faint">chunk store (.chunks/ — one file per unique digest)</div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(store).map(([d]) => (
          <div
            key={d}
            title={d}
            className={clsx("animate-rise rounded-sm px-1 font-mono text-[9px] text-ink/90", !referenced.has(d) && "opacity-40 outline-1 outline-bad outline-dashed")}
            style={{ background: d === digest("zero") ? "var(--color-panel-2)" : `hsl(${hue(d)} 55% 45% / .55)` }}
          >
            {d}
          </div>
        ))}
        {gcInfo?.removed.map((d) => (
          <div key={"x" + d} className="rounded-sm px-1 font-mono text-[9px] text-bad line-through opacity-60">{d}</div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <p key={log} className="animate-rise text-sm leading-relaxed text-muted">{log}</p>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="logical" value={`${logicalMiB} MiB`} />
          <Stat label="on disk" value={`${storedMiB} MiB`} tone="good" />
          <Stat label="dedup" value={storedMiB ? `${(logicalMiB / storedMiB).toFixed(1)}×` : "–"} />
        </div>
      </div>
    </Panel>
  );
}

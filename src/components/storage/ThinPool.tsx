"use client";

import { useState } from "react";
import clsx from "clsx";
import { Callout, Slider, Stat, Toggle } from "@/components/ui";

const POOL = 1000; // GiB of data space in the thin pool
const VDISK = 100; // GiB virtual size per VM disk
const SPREAD = [1.25, 0.7, 1.1, 0.9, 1.35, 0.6, 1.0, 1.2, 0.8, 1.15, 0.95, 1.3, 0.75, 1.05, 0.85, 1.2, 0.65, 1.1, 0.9, 1.0];
const COLORS = ["var(--color-f1)", "var(--color-f2)", "var(--color-f4)", "var(--color-f6)", "var(--color-f3)", "var(--color-f5)"];

export function ThinPool() {
  const [vms, setVms] = useState(14);
  const [fill, setFill] = useState(45);
  const [discard, setDiscard] = useState(false);
  const [snaps, setSnaps] = useState(false);

  // What each guest has written over its lifetime (GiB), and what the pool must still hold for it.
  const disks = Array.from({ length: vms }, (_, i) => {
    const written = Math.min(VDISK, (VDISK * fill * SPREAD[i]) / 100);
    const freedInGuest = written * 0.25; // files deleted inside the guest
    const live = discard ? written - freedInGuest : written; // without discard/TRIM the pool never learns
    const pinned = snaps ? written * 0.2 : 0; // old blocks kept alive by snapshots
    return { written, live, pinned, held: live + pinned };
  });
  const virtual = vms * VDISK;
  const demand = disks.reduce((a, d) => a + d.held, 0);
  const used = Math.min(POOL, demand);
  const pct = (used / POOL) * 100;
  const meta = Math.min(100, (demand / POOL) * 100 * (snaps ? 1.15 : 1) * 0.9);
  const metaFull = meta >= 100;
  const full = demand >= POOL || metaFull;
  const state = full ? "bad" : pct >= 80 ? "warn" : "good";

  let acc = 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Slider label="VMs (100 GiB disks)" value={vms} min={1} max={20} onChange={setVms} />
        <Slider label="guests write" value={fill} min={0} max={100} onChange={setFill} format={(v) => `${v}%`} />
        <Toggle checked={discard} onChange={setDiscard} label="discard=on + fstrim in guests" />
        <Toggle checked={snaps} onChange={setSnaps} label="keep snapshots" />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="promised (virtual)" value={`${virtual} GiB`} />
        <Stat label="pool size" value={`${POOL} GiB`} />
        <Stat label="overcommit" value={`${(virtual / POOL).toFixed(1)}×`} tone={virtual > POOL ? "warn" : "neutral"} />
        <Stat label="data used" value={`${pct.toFixed(0)}%`} tone={state} />
      </div>

      {/* the promise: every VM's virtual disk */}
      <div>
        <div className="mb-1.5 text-[11px] tracking-wide text-faint uppercase">what each VM believes it has</div>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
          {disks.map((d, i) => (
            <div
              key={i}
              className={clsx("relative h-14 overflow-hidden rounded-md border bg-bg", full ? "animate-pulse-soft border-bad" : "border-line")}
              title={`VM ${100 + i}: wrote ${d.written.toFixed(0)} GiB of 100`}
            >
              <div
                className="absolute inset-x-0 bottom-0 transition-all duration-500"
                style={{ height: `${d.written}%`, background: `color-mix(in srgb, ${COLORS[i % COLORS.length]} 55%, transparent)` }}
              />
              <span className="absolute top-0.5 left-1 font-mono text-[9px] text-muted">{100 + i}</span>
              {full && <span className="absolute right-0.5 bottom-0.5 rounded bg-bad/80 px-0.5 font-mono text-[8px] text-black">paused</span>}
            </div>
          ))}
        </div>
      </div>

      {/* the reality: the thin pool */}
      <div>
        <div className="mb-1.5 flex justify-between text-[11px] tracking-wide text-faint uppercase">
          <span>thin pool pve/data · data</span>
          <span className="font-mono normal-case">
            {used.toFixed(0)} / {POOL} GiB
          </span>
        </div>
        <div className="relative h-8 overflow-hidden rounded-md border border-line bg-bg">
          {disks.map((d, i) => {
            const left = (Math.min(acc, POOL) / POOL) * 100;
            acc += d.held;
            const w = (Math.min(acc, POOL) / POOL) * 100 - left;
            return (
              <div
                key={i}
                className="absolute inset-y-0 border-r border-bg transition-all duration-500"
                style={{ left: `${left}%`, width: `${w}%`, background: `color-mix(in srgb, ${COLORS[i % COLORS.length]} 60%, transparent)` }}
              />
            );
          })}
          <div className="absolute inset-y-0 border-l border-dashed border-warn" style={{ left: "80%" }} title="80%: alert threshold" />
        </div>
        <div className="mt-3 mb-1.5 flex justify-between text-[11px] tracking-wide text-faint uppercase">
          <span>thin pool · metadata (block mappings)</span>
          <span className="font-mono normal-case">{meta.toFixed(0)}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full border border-line bg-bg">
          <div
            className={clsx("h-full transition-all duration-500", meta >= 100 ? "bg-bad" : meta >= 80 ? "bg-warn" : "bg-info")}
            style={{ width: `${meta}%` }}
          />
        </div>
      </div>

      {full ? (
        <Callout tone="bad" title={metaFull && demand < POOL ? "Metadata is full: snapshots ate the mapping space before the data ran out" : "The pool is out of space, but every guest still thinks it has free disk"}>
          Writes to unallocated blocks fail. QEMU&apos;s default error policy pauses the affected VMs with an <code>io-error</code> status, and
          containers see I/O errors. If <em>metadata</em> fills up instead, it is worse: the pool can switch to read-only or need a{" "}
          <code>lvconvert --repair</code>. The fix is to grow the pool (or delete snapshots) before you get here.
        </Callout>
      ) : pct >= 80 ? (
        <Callout tone="warn" title="Getting tight">
          Over 80% of a thin pool is the time to act: extend it (<code>lvextend -L +200G pve/data</code>), delete old snapshots, or enable
          discard so blocks freed inside guests go back to the pool.
        </Callout>
      ) : (
        <Callout tone="ok" title="Overcommit is fine while guests are mostly empty">
          The pool only backs blocks a guest has actually written. You promised {virtual} GiB on {POOL} GiB of disk, and that holds as long as
          someone watches the real usage.
        </Callout>
      )}
      <p className="text-xs text-faint">
        Without discard, deleting files in a guest frees nothing on the host: the filesystem just marks blocks free. With <code>discard=on</code>{" "}
        on the virtual disk and periodic <code>fstrim</code> inside the guest, unmapped blocks are returned. Snapshots pin the old version of every
        block overwritten since they were taken. The same arithmetic applies to sparse zvols and Ceph RBD images.
      </p>
    </div>
  );
}

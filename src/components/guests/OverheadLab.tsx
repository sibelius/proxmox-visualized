"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Panel, Slider, Stat } from "../ui";

type Phase = { label: string; s: number; color: string };

const VM_BOOT: Phase[] = [
  { label: "QEMU start + OVMF firmware (POST)", s: 2.5, color: "#5a6275" },
  { label: "bootloader (GRUB / systemd-boot)", s: 1.0, color: "#a78bfa" },
  { label: "guest kernel + initramfs", s: 3.0, color: "#e57000" },
  { label: "systemd → multi-user", s: 4.5, color: "#38bdf8" },
];
const CT_BOOT: Phase[] = [
  { label: "lxc-start: namespaces, cgroup, idmap, mounts", s: 0.3, color: "#34d399" },
  { label: "systemd in the container", s: 1.2, color: "#38bdf8" },
];

const total = (p: Phase[]) => p.reduce((a, b) => a + b.s, 0);
const SPEED = 2.2; // simulated seconds per real second

function Timeline({ name, phases, t, max }: { name: string; phases: Phase[]; t: number; max: number }) {
  let acc = 0;
  const done = t >= total(phases);
  const current = phases.find((p) => {
    const start = acc;
    acc += p.s;
    return t >= start && t < acc;
  });
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-mono text-ink">{name}</span>
        <span className="truncate text-faint">{done ? "login prompt ✓" : t > 0 ? current?.label : "stopped"}</span>
      </div>
      <div className="relative flex h-7 overflow-hidden rounded-md border border-line bg-bg">
        {phases.map((p) => (
          <div key={p.label} className="h-full border-r border-bg" style={{ width: `${(p.s / max) * 100}%`, background: `${p.color}26` }} title={`${p.label}: ${p.s}s`} />
        ))}
        {(() => {
          let start = 0;
          return phases.map((p) => {
            const vis = Math.min(p.s, Math.max(0, t - start));
            const left = start;
            start += p.s;
            return (
              <div
                key={p.label}
                className="absolute inset-y-0"
                style={{ left: `${(left / max) * 100}%`, width: `${(vis / max) * 100}%`, background: p.color }}
              />
            );
          });
        })()}
      </div>
    </div>
  );
}

export function OverheadLab() {
  const [t, setT] = useState(0);
  const [running, setRunning] = useState(false);
  const [n, setN] = useState(10);
  const [app, setApp] = useState(256);
  const raf = useRef<number | null>(null);

  const vmTotal = total(VM_BOOT);
  const ctTotal = total(CT_BOOT);

  useEffect(() => {
    if (!running) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const nv = ((now - t0) / 1000) * SPEED;
      if (nv >= vmTotal) {
        setT(vmTotal);
        setRunning(false);
        return;
      }
      setT(nv);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [running, vmTotal]);

  // Rough per-guest memory model (MiB): what each guest needs besides the app itself.
  const VM_OVER = 220; // guest kernel + its page cache/slab + base systemd userspace + QEMU process overhead
  const CT_OVER = 25; // init, journald, a few daemons; page cache is the host's
  const vmMem = n * (app + VM_OVER);
  const ctMem = n * (app + CT_OVER);
  const maxMem = Math.max(vmMem, 1);
  const gib = (m: number) => `${(m / 1024).toFixed(1)} GiB`;

  return (
    <Panel title="What a guest kernel costs" right={<span className="text-xs text-faint">simulated, typical small Debian guests</span>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={() => {
                setT(0);
                setRunning(true);
              }}
            >
              {running ? "Booting…" : "Boot both"}
            </Button>
            <span className="font-mono text-sm tabular-nums text-muted">t = {t.toFixed(1)} s</span>
            <span className="text-xs text-faint">
              CT ready at {ctTotal.toFixed(1)} s · VM at {vmTotal.toFixed(1)} s
            </span>
          </div>
          <div className="space-y-4">
            <Timeline name="VM 100" phases={VM_BOOT} t={t} max={vmTotal} />
            <Timeline name="CT 101" phases={CT_BOOT} t={t} max={vmTotal} />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            A VM boots like a physical server: firmware, bootloader, its own kernel, then init. A container skips straight
            to init, because the kernel is already running: <span className="text-ink">pct start</span> only sets up namespaces
            and cgroups around a new process tree. Real VM numbers range from ~{(vmTotal * 0.5).toFixed(0)} s (SeaBIOS, tuned
            initramfs) to a minute (Windows).
          </p>
        </div>

        <div>
          <div className="flex flex-col gap-2">
            <Slider label="guests" value={n} min={1} max={60} onChange={setN} />
            <Slider label="app RAM each" value={app} min={64} max={2048} step={64} onChange={setApp} format={(v) => `${v} MiB`} />
          </div>
          <div className="mt-4 space-y-3">
            {[
              { name: "VMs", v: vmMem, over: n * VM_OVER, color: "#e57000" },
              { name: "CTs", v: ctMem, over: n * CT_OVER, color: "#34d399" },
            ].map((r) => (
              <div key={r.name}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-mono text-ink">
                    {n} {r.name}
                  </span>
                  <span className="font-mono text-muted tabular-nums">
                    {gib(r.v)} <span className="text-faint">({gib(r.over)} overhead)</span>
                  </span>
                </div>
                <div className="flex h-5 overflow-hidden rounded-md border border-line bg-bg">
                  <div className="h-full transition-all duration-300" style={{ width: `${((r.v - r.over) / maxMem) * 100}%`, background: `${r.color}99` }} />
                  <div
                    className="h-full transition-all duration-300"
                    style={{ width: `${(r.over / maxMem) * 100}%`, background: `repeating-linear-gradient(45deg, ${r.color}55 0 4px, transparent 4px 8px)` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label="overhead / VM" value={`~${VM_OVER} MiB`} tone="warn" />
            <Stat label="overhead / CT" value={`~${CT_OVER} MiB`} tone="good" />
            <Stat label="saved" value={gib(vmMem - ctMem)} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-faint">
            Solid = the app, hatched = per-guest overhead. A rough model: every VM carries its own kernel, slab and page cache;
            containers share the host&apos;s. KSM (same-page merging) and the balloon driver claw some VM memory back.
          </p>
        </div>
      </div>
    </Panel>
  );
}

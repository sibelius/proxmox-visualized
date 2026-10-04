"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Panel, Segmented } from "@/components/ui";

type G = "run" | "freeze" | "down" | "boot";
type Seg = { a: number; b: number; kind: G; label?: string };
type B = { a: number; b: number; label: string };
type Mode = { mode: "stop" | "suspend" | "snapshot"; guest: Seg[]; backup: B[]; downtime: string; tone: "ok" | "warn" | "bad"; note: string };

const T = 130;

const VM: Mode[] = [
  {
    mode: "stop",
    guest: [
      { a: 0, b: 6, kind: "run" },
      { a: 6, b: 16, kind: "down", label: "shutdown" },
      { a: 16, b: 30, kind: "boot", label: "boot" },
      { a: 30, b: T, kind: "run" },
    ],
    backup: [{ a: 16, b: 116, label: "QEMU backup job (copy-before-write)" }],
    downtime: "shutdown + boot",
    tone: "bad",
    note: "Clean shutdown gives a fully consistent image. The backup starts while the VM is off, then the VM boots again and runs while the job keeps reading.",
  },
  {
    mode: "suspend",
    guest: [
      { a: 0, b: 6, kind: "run" },
      { a: 6, b: 12, kind: "freeze", label: "suspended" },
      { a: 12, b: T, kind: "run" },
    ],
    backup: [{ a: 10, b: 110, label: "QEMU backup job (copy-before-write)" }],
    downtime: "short pause",
    tone: "warn",
    note: "Kept for compatibility: suspends the VM, then does a snapshot-mode backup. Longer pause than snapshot mode, no real consistency gain. Use snapshot.",
  },
  {
    mode: "snapshot",
    guest: [
      { a: 0, b: 6, kind: "run" },
      { a: 6, b: 8, kind: "freeze", label: "fsfreeze" },
      { a: 8, b: T, kind: "run" },
    ],
    backup: [{ a: 8, b: 108, label: "QEMU backup job (copy-before-write)" }],
    downtime: "≈ none",
    tone: "ok",
    note: "Live backup. With the guest agent (agent: 1), filesystems are frozen for a moment (guest-fsfreeze-freeze/thaw) so the image is file-system consistent.",
  },
];

const CT: Mode[] = [
  {
    mode: "stop",
    guest: [
      { a: 0, b: 6, kind: "run" },
      { a: 6, b: 112, kind: "down", label: "stopped for the whole backup" },
      { a: 112, b: 118, kind: "boot", label: "start" },
      { a: 118, b: T, kind: "run" },
    ],
    backup: [{ a: 10, b: 110, label: "tar/pxar of the stopped rootfs" }],
    downtime: "whole backup",
    tone: "bad",
    note: "No copy-before-write trick for containers: consistency means keeping the CT stopped until the archive is written.",
  },
  {
    mode: "suspend",
    guest: [
      { a: 0, b: 6, kind: "run" },
      { a: 6, b: 62, kind: "run" },
      { a: 62, b: 70, kind: "freeze", label: "frozen" },
      { a: 70, b: T, kind: "run" },
    ],
    backup: [
      { a: 6, b: 62, label: "rsync #1 → tmpdir" },
      { a: 62, b: 70, label: "rsync #2" },
      { a: 70, b: 124, label: "archive tmpdir" },
    ],
    downtime: "second rsync",
    tone: "warn",
    note: "rsync the running CT to a temp dir, freeze it, rsync again (only changes), thaw, then archive the copy. Needs scratch space as big as the CT.",
  },
  {
    mode: "snapshot",
    guest: [
      { a: 0, b: 6, kind: "run" },
      { a: 6, b: 8, kind: "freeze", label: "freeze" },
      { a: 8, b: T, kind: "run" },
    ],
    backup: [{ a: 8, b: 108, label: "archive from storage snapshot" }],
    downtime: "≈ none",
    tone: "ok",
    note: "Takes a temporary storage snapshot (ZFS, LVM-thin, Ceph RBD…) while briefly frozen, archives the snapshot, deletes it. Only on storages that can snapshot.",
  },
];

const COLOR: Record<G, string> = { run: "var(--color-ok)", freeze: "var(--color-warn)", down: "var(--color-bad)", boot: "var(--color-info)" };

export function VzdumpModes() {
  const [guest, setGuest] = useState<"vm" | "ct">("vm");
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => (x + 0.6) % (T + 10)), 50);
    return () => clearInterval(id);
  }, []);
  const modes = guest === "vm" ? VM : CT;
  const pct = (x: number) => `${(x / T) * 100}%`;
  const now = Math.min(t, T);

  return (
    <Panel
      title="vzdump modes: what the guest feels"
      right={<Segmented value={guest} onChange={setGuest} options={[{ value: "vm", label: "VM (qemu)" }, { value: "ct", label: "container (lxc)" }]} />}
    >
      <div className="space-y-5">
        {modes.map((m) => {
          const cur = m.guest.find((g) => now >= g.a && now < g.b) ?? m.guest[m.guest.length - 1];
          return (
            <div key={guest + m.mode} className="animate-rise">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm text-ink">--mode {m.mode}</span>
                  <span className="font-mono text-[11px]" style={{ color: COLOR[cur.kind] }}>
                    guest: {cur.kind === "run" ? "running" : cur.label}
                  </span>
                </div>
                <span className={clsx("font-mono text-xs", m.tone === "ok" && "text-ok", m.tone === "warn" && "text-warn", m.tone === "bad" && "text-bad")}>
                  downtime: {m.downtime}
                </span>
              </div>
              <div className="relative space-y-1">
                <div className="relative h-6 overflow-hidden rounded bg-bg">
                  {m.guest.map((g, i) => (
                    <div
                      key={i}
                      className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-r border-bg font-mono text-[10px] whitespace-nowrap text-bg"
                      style={{ left: pct(g.a), width: pct(g.b - g.a), background: g.kind === "run" ? "color-mix(in srgb, var(--color-ok) 30%, transparent)" : COLOR[g.kind] }}
                    >
                      {g.kind !== "run" && g.b - g.a > 4 ? g.label : ""}
                    </div>
                  ))}
                </div>
                <div className="relative h-5">
                  {m.backup.map((b, i) => (
                    <div
                      key={i}
                      className="absolute inset-y-0 overflow-hidden rounded border border-accent-2/50 bg-accent-2/15 px-1.5 font-mono text-[10px] leading-5 whitespace-nowrap text-accent-2"
                      style={{ left: pct(b.a), width: pct(b.b - b.a) }}
                    >
                      <div className="absolute inset-y-0 left-0 bg-accent-2/25" style={{ width: `${Math.max(0, Math.min(100, ((now - b.a) / (b.b - b.a)) * 100))}%` }} />
                      <span className="relative">{b.label}</span>
                    </div>
                  ))}
                </div>
                <div className="pointer-events-none absolute -inset-y-1 w-px bg-ink/70" style={{ left: pct(now) }} />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{m.note}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 border-t border-line pt-3 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-sm bg-ok/30" /> guest running</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-sm bg-warn" /> paused / frozen</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-sm bg-bad" /> down</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-sm bg-info" /> booting</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-sm border border-accent-2/50 bg-accent-2/15" /> backup running</span>
      </div>
    </Panel>
  );
}

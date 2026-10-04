"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Panel, Segmented } from "@/components/ui";

type Kind = "shared" | "local" | "ct";

type Step = { label: string; detail: string; moves: ("ram" | "disk" | "state")[]; guest: "running" | "paused" | "stopped" | "target" };

const STEPS: Record<Kind, Step[]> = {
  shared: [
    { label: "start target QEMU", detail: "pve2 starts an empty, paused QEMU with the same config (incoming migration).", moves: [], guest: "running" },
    { label: "pre-copy RAM", detail: "RAM is copied in iterations while the guest runs. The disk is not touched: both nodes already see it on Ceph/NFS/iSCSI.", moves: ["ram"], guest: "running" },
    { label: "stop-and-copy", detail: "vCPUs pause; last dirty pages and device state go over.", moves: ["ram", "state"], guest: "paused" },
    { label: "switchover", detail: "pve2 resumes the guest and takes over its storage access; pve1 drops it. Downtime: tens of ms.", moves: [], guest: "target" },
  ],
  local: [
    { label: "start target + NBD", detail: "pve2 allocates new volumes on its target storage and exports them via an NBD server.", moves: [], guest: "running" },
    { label: "drive-mirror", detail: "QEMU's block mirror copies every allocated block of the local disk to the target, while the guest keeps writing.", moves: ["disk"], guest: "running" },
    { label: "mirror ready", detail: "Mirror caught up; from now on every guest write is sent to both copies, so they stay in sync.", moves: ["disk"], guest: "running" },
    { label: "pre-copy RAM", detail: "Now the normal RAM migration runs (same as shared storage).", moves: ["ram", "disk"], guest: "running" },
    { label: "stop-and-copy", detail: "vCPUs pause, mirror jobs complete, last pages + device state sent.", moves: ["ram", "state"], guest: "paused" },
    { label: "switchover", detail: "Guest resumes on pve2 with its new local disk; old volumes on pve1 are deleted.", moves: [], guest: "target" },
  ],
  ct: [
    { label: "shut down CT", detail: "Containers can't be live-migrated (no CRIU). With --restart the CT is cleanly stopped.", moves: [], guest: "stopped" },
    { label: "copy rootfs", detail: "Local volumes are copied (ZFS: zfs send, incremental if replicated). On shared storage nothing is copied.", moves: ["disk"], guest: "stopped" },
    { label: "move config", detail: "/etc/pve/lxc/<id>.conf is moved to pve2's directory in pmxcfs: that's the actual \"move\".", moves: ["state"], guest: "stopped" },
    { label: "start on target", detail: "The CT boots on pve2. Downtime = shutdown + copy + boot: seconds to minutes.", moves: [], guest: "target" },
  ],
};

const DOWNTIME: Record<Kind, { v: string; tone: string }> = {
  shared: { v: "≈ 10–300 ms", tone: "text-ok" },
  local: { v: "≈ 10–300 ms (but long total time)", tone: "text-ok" },
  ct: { v: "seconds to minutes", tone: "text-warn" },
};

export function MigrationKinds() {
  const [kind, setKind] = useState<Kind>("shared");
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const steps = STEPS[kind];
  const step = steps[Math.min(i, steps.length - 1)];

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setI((x) => (x + 1) % steps.length), 2200);
    return () => clearInterval(id);
  }, [auto, steps.length]);

  const choose = (k: Kind) => {
    setKind(k);
    setI(0);
  };

  const onTarget = step.guest === "target";
  const shared = kind === "shared" || false;

  return (
    <Panel
      title="What actually moves"
      right={
        <Segmented
          value={kind}
          onChange={choose}
          options={[
            { value: "shared", label: "VM · shared storage" },
            { value: "local", label: "VM · local disks" },
            { value: "ct", label: "container" },
          ]}
        />
      }
    >
      <svg viewBox={`0 0 520 ${kind === "shared" ? 196 : 168}`} className="mx-auto w-full max-w-2xl" role="img" aria-label={`${step.label}: ${step.detail}`}>
        {(["pve1", "pve2"] as const).map((n, k) => {
          const x = k === 0 ? 20 : 340;
          const hosts = (k === 0 && !onTarget) || (k === 1 && onTarget);
          const g = step.guest;
          return (
            <g key={n}>
              <rect x={x} y={10} width={160} height={kind === "shared" ? 110 : 150} rx={10} fill="var(--color-panel-2)" stroke="var(--color-line)" />
              <text x={x + 10} y={28} className="fill-muted font-mono text-[11px]">{n}</text>
              {/* guest box */}
              <rect
                x={x + 15} y={38} width={130} height={36} rx={6}
                fill={hosts ? (g === "paused" ? "color-mix(in srgb, var(--color-warn) 20%, transparent)" : g === "stopped" ? "var(--color-bg)" : "color-mix(in srgb, var(--color-ok) 18%, transparent)") : "transparent"}
                stroke={hosts ? (g === "paused" ? "var(--color-warn)" : g === "stopped" ? "var(--color-faint)" : "var(--color-ok)") : "var(--color-line)"}
                strokeDasharray={hosts ? undefined : "4 4"}
                style={{ transition: "all 400ms" }}
              />
              <text x={x + 80} y={60} textAnchor="middle" className={clsx("font-mono text-[11px]", hosts ? "fill-ink" : "fill-faint")}>
                {kind === "ct" ? "CT 200" : "VM 100"} {hosts ? `· ${g === "target" ? "running" : g}` : ""}
              </text>
              <rect x={x + 15} y={82} width={60} height={26} rx={4} fill="var(--color-bg)" stroke="var(--color-info)" strokeOpacity={hosts || step.moves.includes("ram") ? 0.8 : 0.25} />
              <text x={x + 45} y={99} textAnchor="middle" className="fill-info font-mono text-[10px]">{kind === "ct" ? "procs" : "RAM"}</text>
              {kind !== "shared" && (
                <>
                  <rect x={x + 15} y={118} width={130} height={30} rx={4} fill="var(--color-bg)" stroke="var(--color-accent-2)" strokeOpacity={k === 0 || i > 0 ? 0.8 : 0.2} />
                  <text x={x + 80} y={137} textAnchor="middle" className="fill-accent-2 font-mono text-[10px]">
                    {k === 0 ? "local-zfs: disk-0" : step.moves.includes("disk") || onTarget || i > 1 ? "target: disk-0" : "(not yet)"}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {shared && (
          <g>
            <rect x={110} y={150} width={300} height={36} rx={8} fill="var(--color-bg)" stroke="var(--color-accent-2)" />
            <text x={260} y={172} textAnchor="middle" className="fill-accent-2 font-mono text-[11px]">shared storage (Ceph RBD) · vm-100-disk-0</text>
            <line x1={100} y1={120} x2={180} y2={150} stroke="var(--color-accent-2)" strokeOpacity={onTarget ? 0.2 : 0.8} />
            <line x1={420} y1={120} x2={340} y2={150} stroke="var(--color-accent-2)" strokeOpacity={onTarget ? 0.8 : 0.2} />
          </g>
        )}
        {/* transfer arrows */}
        {step.moves.includes("ram") && <Flow y={95} color="var(--color-info)" label={kind === "ct" ? "" : "RAM pages"} />}
        {step.moves.includes("disk") && <Flow y={133} color="var(--color-accent-2)" label={kind === "ct" ? "rootfs copy" : "drive-mirror (NBD)"} />}
        {step.moves.includes("state") && <Flow y={56} color="var(--color-warn)" label={kind === "ct" ? "config move" : "device state"} />}
      </svg>

      <ol className="mt-3 flex flex-wrap gap-1.5">
        {steps.map((s, k) => (
          <li key={s.label}>
            <button
              type="button"
              onClick={() => { setAuto(false); setI(k); }}
              className={clsx("rounded-md border px-2 py-1 font-mono text-[11px] transition", k === i ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:text-ink")}
            >
              {k + 1}. {s.label}
            </button>
          </li>
        ))}
        <li>
          <Button variant="ghost" className="!py-1 text-xs" onClick={() => setAuto(!auto)}>
            {auto ? "❚❚" : "▶"}
          </Button>
        </li>
      </ol>
      <p key={kind + i} className="mt-2 min-h-10 animate-rise text-sm leading-relaxed text-muted">{step.detail}</p>
      <div className="mt-2 font-mono text-xs text-faint">
        guest downtime: <span className={DOWNTIME[kind].tone}>{DOWNTIME[kind].v}</span>
      </div>
    </Panel>
  );
}

function Flow({ y, color, label }: { y: number; color: string; label: string }) {
  return (
    <g>
      <line x1={182} y1={y} x2={336} y2={y} stroke={color} strokeWidth={2.5} strokeDasharray="6 6" className="animate-dash" />
      <path d={`M336 ${y - 5} L344 ${y} L336 ${y + 5} Z`} fill={color} />
      {label && (
        <text x={260} y={y - 6} textAnchor="middle" className="font-mono text-[10px]" fill={color}>
          {label}
        </text>
      )}
    </g>
  );
}

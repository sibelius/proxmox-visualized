"use client";

import { useState } from "react";
import clsx from "clsx";
import { Panel, Segmented } from "../ui";

type Mode = "both" | "vm" | "ct";

type Layer = { label: string; sub: string; color: string; guest: boolean; boundary?: boolean };

const VM_LAYERS: Layer[] = [
  { label: "your app", sub: "nginx, postgres…", color: "#e7e9f0", guest: true },
  { label: "guest userspace", sub: "any OS: Linux, Windows, BSD", color: "#e7e9f0", guest: true },
  { label: "guest kernel", sub: "its own kernel, own modules", color: "#e57000", guest: true },
  { label: "virtual hardware", sub: "q35 chipset · OVMF · virtio-net/-scsi", color: "#e57000", guest: true, boundary: true },
  { label: "QEMU process + KVM", sub: "/usr/bin/kvm · /dev/kvm · VT-x", color: "#38bdf8", guest: false },
  { label: "host kernel", sub: "proxmox-kernel 6.x", color: "#38bdf8", guest: false },
  { label: "hardware", sub: "", color: "#5a6275", guest: false },
];

const CT_LAYERS: Layer[] = [
  { label: "your app", sub: "nginx, postgres…", color: "#e7e9f0", guest: true },
  { label: "guest userspace", sub: "Linux distro rootfs only", color: "#e7e9f0", guest: true },
  { label: "namespaces · cgroups · AppArmor · seccomp", sub: "a fence around processes", color: "#34d399", guest: true, boundary: true },
  { label: "host kernel (shared)", sub: "the same kernel for every CT", color: "#38bdf8", guest: false },
  { label: "hardware", sub: "", color: "#5a6275", guest: false },
];

const NOTES = {
  vm: {
    title: "Full virtual machine (qm)",
    boundary: "Boundary: virtual hardware. The guest talks to emulated/paravirtual devices and the CPU traps privileged instructions to KVM. To escape, an attacker needs a bug in QEMU's device model or KVM itself.",
    items: [
      "Any OS that runs on x86-64: Windows, BSDs, other Linux kernels",
      "Load any kernel module, run Docker/Kubernetes natively",
      "Live migration: RAM is copied while it runs",
      "PCI(e) passthrough, vTPM, Secure Boot, GPUs",
      "Costs a guest kernel, page cache and firmware per VM",
    ],
  },
  ct: {
    title: "System container (pct)",
    boundary: "Boundary: the syscall interface. Container processes are host processes making normal syscalls to the shared kernel; namespaces hide the rest of the system, seccomp and AppArmor filter dangerous calls. A kernel bug is a potential escape for every container at once.",
    items: [
      "Linux only, and it runs the host's kernel version",
      "No own kernel modules; some need features enabled (nesting, keyctl, fuse)",
      "Migration = stop, move, start (restart mode). No live migration",
      "Boots in ~1 s, idles at a few MB of RAM",
      "Bind mounts give near-native file system access",
    ],
  },
};

function Stack({ kind, layers, dim }: { kind: "vm" | "ct"; layers: Layer[]; dim: boolean }) {
  const color = kind === "vm" ? "#e57000" : "#34d399";
  const guestCount = layers.filter((l) => l.guest).length;
  return (
    <div className={clsx("flex min-w-0 flex-col transition-opacity", dim && "opacity-35")}>
      <div className="mb-2 flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ background: color }} />
        <span className="font-mono text-xs text-ink">{kind === "vm" ? "VM 100 (KVM)" : "CT 101 (LXC)"}</span>
      </div>
      <div className="relative mt-auto flex flex-col gap-1.5">
        {/* isolation boundary: wraps the guest-owned layers */}
        <div
          className="pointer-events-none absolute -inset-x-1.5 -top-1.5 rounded-xl border-2 border-dashed transition-all duration-500"
          style={{ height: `calc(${guestCount} * 44px + ${guestCount - 1} * 6px + 12px)`, borderColor: color }}
          aria-hidden
        />
        {layers.map((l, k) => (
          <div
            key={l.label}
            className={clsx(
              "relative flex h-11 flex-col justify-center rounded-lg border px-3 transition-all duration-500",
              l.boundary ? "border-transparent" : "border-line",
            )}
            style={{
              background: l.boundary ? `${l.color}22` : l.guest ? "#171b24" : "#11141b",
              boxShadow: l.boundary ? `inset 0 0 0 1px ${l.color}` : undefined,
              transitionDelay: `${k * 40}ms`,
            }}
          >
            <div className="truncate text-[13px] font-medium" style={{ color: l.color === "#5a6275" ? "#8a93a8" : l.color === "#e7e9f0" ? "#e7e9f0" : l.color }}>
              {l.label}
            </div>
            {l.sub && <div className="truncate text-[11px] text-faint">{l.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GuestLayers() {
  const [mode, setMode] = useState<Mode>("both");
  const focus: ("vm" | "ct")[] = mode === "both" ? ["vm", "ct"] : [mode];

  return (
    <Panel
      title="Where the guest ends and the host begins"
      right={
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "both", label: "side by side" },
            { value: "vm", label: "VM" },
            { value: "ct", label: "Container" },
          ]}
        />
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-2 gap-4">
          <Stack kind="vm" layers={VM_LAYERS} dim={mode === "ct"} />
          <Stack kind="ct" layers={CT_LAYERS} dim={mode === "vm"} />
          <div className="col-span-2 font-mono text-[10.5px] text-faint">dashed box = what the guest owns · its edge is the isolation boundary · bottom layers are the host</div>
        </div>
        <div className="flex flex-col gap-3">
          {focus.map((k) => (
            <div key={k} className="animate-rise rounded-xl border border-line bg-bg/50 p-4">
              <div className="font-medium" style={{ color: k === "vm" ? "#e57000" : "#34d399" }}>
                {NOTES[k].title}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{NOTES[k].boundary}</p>
              {mode !== "both" && (
                <ul className="mt-3 space-y-1 text-sm text-muted">
                  {NOTES[k].items.map((it) => (
                    <li key={it} className="flex gap-2">
                      <span className="text-faint">•</span>
                      {it}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

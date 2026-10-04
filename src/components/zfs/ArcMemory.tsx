"use client";

import { useState } from "react";
import { Mono, Slider, Stat } from "@/components/ui";

const RAM_STEPS = [8, 16, 32, 64, 128, 256, 512, 1024];

export function ArcMemory() {
  const [ramIdx, setRamIdx] = useState(4);
  const [poolTiB, setPoolTiB] = useState(8);
  const ram = RAM_STEPS[ramIdx];
  const installer = Math.min(ram * 0.1, 16);
  const rule = 2 + poolTiB; // docs' rule of thumb: 2 GiB base + 1 GiB per TiB of storage
  const host = 4;
  const guests = Math.max(0, ram - installer - host);
  const bytes = Math.round(installer * 1024 ** 3);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Slider label="host RAM" value={ramIdx} min={0} max={RAM_STEPS.length - 1} onChange={setRamIdx} format={(i) => `${RAM_STEPS[i]} GiB`} />
        <Slider label="pool size" value={poolTiB} min={1} max={64} onChange={setPoolTiB} format={(v) => `${v} TiB`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="installer zfs_arc_max" value={`${installer.toFixed(installer < 10 ? 1 : 0)} GiB`} tone="good" />
        <Stat label="rule of thumb (2 + 1/TiB)" value={`${rule} GiB`} tone={rule > installer ? "warn" : "neutral"} />
        <Stat label="left for guests ≈" value={`${guests.toFixed(0)} GiB`} />
      </div>
      <div className="flex h-7 overflow-hidden rounded-md border border-line font-mono text-[10px]">
        <div className="flex items-center justify-center bg-faint/30 text-muted" style={{ width: `${(host / ram) * 100}%` }} title="host OS">
          {host / ram > 0.08 ? "host" : ""}
        </div>
        <div className="flex items-center justify-center bg-f6/40 text-ink transition-all" style={{ width: `${(installer / ram) * 100}%` }} title="ARC max">
          {installer / ram > 0.06 ? "ARC" : ""}
        </div>
        <div className="flex flex-1 items-center justify-center bg-f1/20 text-muted">VMs and containers</div>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        The ARC is ZFS&apos;s read cache in RAM. It does shrink under memory pressure, but not instantly, and RAM promised to VMs is not something
        you want to compete for. New installs since PVE 8.1 cap it at 10% of RAM, at most 16 GiB.{" "}
        {rule > installer
          ? "For this pool that is below the documented rule of thumb; raise it if the hit rate (arc_summary) is poor."
          : "That already covers the documented rule of thumb for this pool."}
      </p>
      <Mono>
        {`# /etc/modprobe.d/zfs.conf
options zfs zfs_arc_max=${bytes}
# apply now without reboot:
echo ${bytes} > /sys/module/zfs/parameters/zfs_arc_max
# rpool as root: also run  update-initramfs -u -k all`}
      </Mono>
    </div>
  );
}

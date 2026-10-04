"use client";

import { useState } from "react";
import clsx from "clsx";
import { STORAGES } from "./data";

const COLORS = ["var(--color-f1)", "var(--color-f4)", "var(--color-f3)", "var(--color-f2)", "var(--color-f6)", "var(--color-f5)"];

export function BytesPath() {
  const [id, setId] = useState("lvmthin");
  const s = STORAGES.find((x) => x.id === id)!;
  const vmDisk = s.content.includes("images");
  const layers = [
    vmDisk
      ? { label: "guest", value: "VM 100 sees /dev/sda (virtio-scsi)", note: undefined as string | undefined }
      : { label: "consumer", value: s.id === "pbs" ? "vzdump / proxmox-backup-client on the PVE node" : "PVE reads it to boot an installer / create a CT" },
    vmDisk
      ? { label: "VM config", value: `scsi0: ${s.volid},size=32G`, note: "/etc/pve/qemu-server/100.conf: <storage id>:<volume name>" }
      : { label: "volume id", value: s.volid, note: undefined },
    ...s.chain,
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className="flex flex-wrap gap-1.5 lg:flex-col" role="listbox" aria-label="Storage type">
        {STORAGES.map((x) => (
          <button
            key={x.id}
            type="button"
            role="option"
            aria-selected={x.id === id}
            onClick={() => setId(x.id)}
            className={clsx(
              "flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-xs transition",
              x.id === id ? "border-accent bg-accent/10 text-ink" : "border-line bg-panel-2 text-muted hover:text-ink",
            )}
          >
            {x.name}
            <span className="hidden font-mono text-[10px] text-faint lg:inline">{x.type}</span>
          </button>
        ))}
      </div>

      <div key={id} className="relative">
        <ol className="space-y-0">
          {layers.map((l, i) => (
            <li key={i} className="animate-rise" style={{ animationDelay: `${i * 70}ms` }}>
              {i > 0 && (
                <svg width="24" height="26" className="ml-6 block" aria-hidden>
                  <line x1="12" y1="0" x2="12" y2="26" stroke={COLORS[i % COLORS.length]} strokeWidth="2" strokeDasharray="6 6" className="animate-dash" />
                </svg>
              )}
              <div
                className="rounded-lg border bg-panel-2/60 px-3 py-2"
                style={{ borderColor: `color-mix(in srgb, ${COLORS[i % COLORS.length]} 45%, var(--color-line))` }}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="w-28 shrink-0 font-mono text-[10px] tracking-wide uppercase" style={{ color: COLORS[i % COLORS.length] }}>
                    {l.label}
                  </span>
                  <span className="min-w-0 font-mono text-[12.5px] break-all text-ink">{l.value}</span>
                </div>
                {l.note && <div className="mt-0.5 text-[11px] text-muted sm:pl-31">{l.note}</div>}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
          <span className={clsx("rounded px-2 py-0.5", s.level === "file" ? "bg-info/15 text-info" : "bg-f4/15 text-f4")}>
            {s.level === "file" ? "file-level: a file on a filesystem" : s.level === "block" ? "block-level: a raw block device" : "both: block (zvol) for VMs, files for CTs"}
          </span>
          <span className={clsx("rounded px-2 py-0.5", s.shared === "yes" ? "bg-ok/15 text-ok" : s.shared === "partial" ? "bg-warn/15 text-warn" : "bg-bad/10 text-bad")}>
            {s.shared === "yes" ? "every node reaches the same bytes" : s.shared === "partial" ? "shared only on shared media" : "bytes live on this node only"}
          </span>
        </div>
      </div>
    </div>
  );
}

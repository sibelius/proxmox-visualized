"use client";

import { useState } from "react";
import clsx from "clsx";
import { Panel, Segmented } from "@/components/ui";

type CpuType = "host" | "x86-64-v2-AES" | "x86-64-v3" | "x86-64-v4";
const HOSTS: { name: string; cpu: string; level: number; vendor: "amd" | "intel" }[] = [
  { name: "pve1", cpu: "AMD EPYC 9354 (Zen 4)", level: 4, vendor: "amd" },
  { name: "pve2", cpu: "AMD EPYC 9354 (Zen 4)", level: 4, vendor: "amd" },
  { name: "pve3", cpu: "Intel Xeon Gold 6330 (Ice Lake)", level: 4, vendor: "intel" },
  { name: "pve4", cpu: "Intel Xeon E5-2680 v2 (Ivy Bridge)", level: 2, vendor: "intel" },
];

const NEED: Record<Exclude<CpuType, "host">, number> = { "x86-64-v2-AES": 2, "x86-64-v3": 3, "x86-64-v4": 4 };
const WHAT: Record<CpuType, string> = {
  host: "Passes the exact host CPU model and all its flags to the guest. Fastest, but the guest may use instructions only this CPU model has.",
  "x86-64-v2-AES": "Default for new VMs. A baseline (SSE4.2, POPCNT, AES-NI…) that every x86 server from the last ~12 years provides.",
  "x86-64-v3": "Adds AVX, AVX2, BMI, FMA: Haswell (2013) / Zen 1 and newer.",
  "x86-64-v4": "Adds AVX-512: Skylake-SP / Ice Lake Xeons, Zen 4 and newer.",
};

export function CpuCompat() {
  const [type, setType] = useState<CpuType>("x86-64-v2-AES");
  const src = HOSTS[0];
  const verdict = (h: (typeof HOSTS)[number]) => {
    if (h.name === src.name) return { ok: true, why: "source" };
    if (type === "host")
      return h.cpu === src.cpu
        ? { ok: true, why: "identical CPU model" }
        : { ok: false, why: h.vendor !== src.vendor ? "different vendor: guest would lose flags it is using" : "different model: flags differ" };
    const need = NEED[type];
    return h.level >= need ? { ok: true, why: `supports v${need}` } : { ok: false, why: `lacks v${need} flags: the guest can't be started there` };
  };
  return (
    <Panel title="CPU type decides where a VM may go" right={<Segmented value={type} onChange={setType} options={["host", "x86-64-v2-AES", "x86-64-v3", "x86-64-v4"] as const} />}>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        <span className="font-mono text-ink">cpu: {type}</span> — {WHAT[type]} A running guest can&apos;t lose CPU features
        mid-flight, so every migration target must offer at least what the guest was started with.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {HOSTS.map((h) => {
          const v = verdict(h);
          const isSrc = h.name === src.name;
          return (
            <div key={h.name} className={clsx("rounded-lg border p-3 transition", isSrc ? "border-info/50" : v.ok ? "border-ok/40 bg-ok/5" : "border-bad/40 bg-bad/5")}>
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="text-ink">{h.name}</span>
                <span className={isSrc ? "text-info" : v.ok ? "text-ok" : "text-bad"}>{isSrc ? "VM runs here" : v.ok ? "✓ can migrate" : "✗ blocked"}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted">{h.cpu}</div>
              <div className="mt-1 font-mono text-[10px] text-faint">{isSrc ? `x86-64-v${h.level}` : v.why}</div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

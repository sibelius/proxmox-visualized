"use client";

import { useState } from "react";
import clsx from "clsx";
import { Panel, Segmented } from "../ui";

type CpuType = "host" | "x86-64-v2-AES" | "x86-64-v3" | "x86-64-v4" | "kvm64";
const FEATS = ["SSE4.2", "POPCNT", "AES-NI", "AVX", "AVX2", "AVX-512"] as const;
type Feat = (typeof FEATS)[number];

const LEVEL: Record<Exclude<CpuType, "host">, { feats: Feat[]; level: number; note: string }> = {
  kvm64: {
    feats: [],
    level: 0,
    note: "Legacy lowest common denominator (roughly a Pentium 4). Migrates anywhere, but no SSE4.2 or AES-NI: crypto is slow and RHEL/Alma 9 refuse to boot. Avoid.",
  },
  "x86-64-v2-AES": {
    feats: ["SSE4.2", "POPCNT", "AES-NI"],
    level: 2,
    note: "The default for new VMs. Runs on anything from Intel Westmere / AMD Opteron G4 up, so it migrates across mixed-generation clusters, and includes AES-NI so TLS and disk encryption stay fast.",
  },
  "x86-64-v3": {
    feats: ["SSE4.2", "POPCNT", "AES-NI", "AVX", "AVX2"],
    level: 3,
    note: "Adds AVX/AVX2, FMA, BMI (Intel Haswell+, AMD Zen+). Needed by RHEL 10 and by distros/binaries built for v3. Every node must support it.",
  },
  "x86-64-v4": {
    feats: ["SSE4.2", "POPCNT", "AES-NI", "AVX", "AVX2", "AVX-512"],
    level: 4,
    note: "Adds AVX-512 (Intel Skylake-SP+, AMD Zen 4+). Rarely worth it: few nodes in a mixed cluster qualify.",
  },
};

const NODES = [
  { name: "pve1", cpu: "AMD EPYC 9354 (Zen 4)", level: 4, model: "zen4", feats: [...FEATS] as Feat[] },
  { name: "pve2", cpu: "AMD EPYC 9354 (Zen 4)", level: 4, model: "zen4", feats: [...FEATS] as Feat[] },
  { name: "pve3", cpu: "Intel Xeon E5-2690 v4 (Broadwell)", level: 3, model: "bdw", feats: ["SSE4.2", "POPCNT", "AES-NI", "AVX", "AVX2"] as Feat[] },
  { name: "pve4", cpu: "Intel Xeon E5-2670 (Sandy Bridge)", level: 2, model: "snb", feats: ["SSE4.2", "POPCNT", "AES-NI", "AVX"] as Feat[] },
];

export function CpuTypePicker() {
  const [type, setType] = useState<CpuType>("x86-64-v2-AES");
  const src = NODES[0];
  const guestFeats: Feat[] = type === "host" ? src.feats : LEVEL[type].feats;

  return (
    <Panel
      title="CPU type decides where a VM may live-migrate"
      right={<Segmented value={type} onChange={setType} options={["host", "x86-64-v2-AES", "x86-64-v3", "x86-64-v4", "kvm64"]} />}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">guest sees:</span>
        {FEATS.map((f) => {
          const on = guestFeats.includes(f);
          return (
            <span
              key={f}
              className={clsx("rounded-md border px-2 py-0.5 font-mono text-[11px] transition", on ? "border-ok/60 text-ok" : "border-line text-faint line-through")}
            >
              {f}
            </span>
          );
        })}
        {type === "host" && <span className="font-mono text-[11px] text-warn">+ every other flag and the exact model/stepping of pve1</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {NODES.map((n, i) => {
          let state: "here" | "ok" | "warn" | "bad";
          let msg: string;
          if (i === 0) {
            state = "here";
            msg = "VM 100 running here";
          } else if (type === "host") {
            if (n.model === src.model) {
              state = "ok";
              msg = "Identical CPU: live migration works";
            } else {
              state = "warn";
              msg = "Different CPU: migration may start, then the guest can crash using an instruction that is missing";
            }
          } else {
            const need = LEVEL[type].level;
            if (n.level >= need) {
              state = "ok";
              msg = "Supports the model: live migration works";
            } else {
              const missing = LEVEL[type].feats.filter((f) => !n.feats.includes(f));
              state = "bad";
              msg = `Can't run this model (missing ${missing.join(", ")}): VM won't even start here`;
            }
          }
          const color = state === "here" ? "#e57000" : state === "ok" ? "#34d399" : state === "warn" ? "#fbbf24" : "#f87171";
          return (
            <div key={n.name} className="rounded-xl border bg-bg/50 p-3 transition-colors" style={{ borderColor: `${color}88` }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-ink">{n.name}</span>
                <span className="font-mono text-[10px] text-faint">x86-64-v{n.level}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted">{n.cpu}</div>
              <div className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-snug" style={{ color }}>
                <span>{state === "here" ? "▶" : state === "ok" ? "✓" : state === "warn" ? "⚠" : "✗"}</span>
                <span>{msg}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-sm leading-relaxed text-muted">
        {type === "host"
          ? "host passes the physical CPU straight through: best performance and every instruction set extension (nested virtualization, AVX-512…), but a live-migrated guest keeps using instructions it detected at boot, so the target must be the same CPU model. Fine for single nodes or homogeneous clusters."
          : LEVEL[type].note}{" "}
        Rule of thumb: pick the newest model that <span className="text-ink">every node</span> in the cluster supports.
      </p>
    </Panel>
  );
}

"use client";

import { useState } from "react";
import clsx from "clsx";
import { Panel, Segmented, Stat, Toggle } from "../ui";

type Layout = "converged" | "separated";

type Traffic = { id: string; label: string; color: string; base: number; burst: number; net: string; cidr: string; mtu: number; detail: string };

const TRAFFIC: Traffic[] = [
  { id: "mgmt", label: "Management / GUI / API", color: "var(--color-f1)", base: 0.2, burst: 0, net: "vmbr0", cidr: "192.168.10.0/24", mtu: 1500, detail: "port 8006, SSH, the default gateway" },
  { id: "corosync", label: "Corosync (cluster)", color: "var(--color-f5)", base: 0.05, burst: 0, net: "eno3 (link0) + vmbr0 (link1)", cidr: "10.10.1.0/24", mtu: 1500, detail: "tiny packets, needs < 5 ms latency, no bandwidth" },
  { id: "ceph", label: "Ceph public + cluster", color: "var(--color-f3)", base: 2, burst: 4, net: "bond1 (2×25G)", cidr: "10.10.2.0/24", mtu: 9000, detail: "replication and recovery: bursts that fill any link" },
  { id: "migration", label: "Live migration", color: "var(--color-f4)", base: 0, burst: 8, net: "bond1 (VLAN 30)", cidr: "10.10.3.0/24", mtu: 9000, detail: "copies whole RAM: line rate for seconds to minutes" },
  { id: "vm", label: "VM traffic", color: "var(--color-f2)", base: 1.5, burst: 0, net: "vmbr0 trunk", cidr: "VLANs 20-99", mtu: 1500, detail: "whatever the guests do" },
];

export function NetworkSeparation() {
  const [layout, setLayout] = useState<Layout>("converged");
  const [ceph, setCeph] = useState(false);
  const [mig, setMig] = useState(false);

  const load = (t: Traffic) => t.base + (t.id === "ceph" && ceph ? t.burst : 0) + (t.id === "migration" && mig ? t.burst : 0);
  const total = TRAFFIC.reduce((a, t) => a + load(t), 0);
  const cap = 10;
  const util = layout === "converged" ? Math.min(total / cap, 1) : Math.min(load(TRAFFIC[1]) / 1, 1);
  // queueing-ish latency: explodes near saturation
  const over = layout === "converged" ? Math.max(total - cap, 0) : 0;
  const latency = layout === "converged" ? (util < 0.7 ? 0.15 + util * 0.3 : 0.4 + (util - 0.7) * 30 + over * 12) : 0.12;
  const fence = latency > 5;

  return (
    <Panel
      title="Who shares the wire with corosync?"
      right={
        <Segmented<Layout>
          value={layout}
          onChange={setLayout}
          options={[
            { value: "converged", label: "everything on one 10G link" },
            { value: "separated", label: "separate networks" },
          ]}
        />
      }
    >
      <div className="mb-4 flex flex-wrap gap-5">
        <Toggle checked={ceph} onChange={setCeph} label="Ceph is recovering after an OSD failure" />
        <Toggle checked={mig} onChange={setMig} label="a 64 GiB VM is live-migrating" />
      </div>

      {layout === "converged" ? (
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-faint">
            <span>bond0 / vmbr0 — 10 Gbit/s</span>
            <span className="font-mono">{total.toFixed(1)} Gbit/s offered</span>
          </div>
          <div className="flex h-8 overflow-hidden rounded-md border border-line bg-bg" role="img" aria-label={`link ${Math.round(util * 100)} percent utilized`}>
            {TRAFFIC.map((t) => (
              <div key={t.id} className="h-full transition-all duration-500" style={{ width: `${(load(t) / Math.max(total, cap)) * 100}%`, background: t.color }} title={t.label} />
            ))}
          </div>
          {over > 0 && <div className="mt-1 text-xs text-bad">Oversubscribed by {over.toFixed(1)} Gbit/s: queues fill, packets wait or drop, including corosync&apos;s.</div>}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {TRAFFIC.map((t) => (
            <div key={t.id} className="rounded-lg border border-line bg-bg p-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="size-2.5 rounded-full" style={{ background: t.color }} />
                <span className="text-ink">{t.label}</span>
                <span className="ml-auto font-mono text-[10px] text-faint">MTU {t.mtu}</span>
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-muted">
                {t.net} · {t.cidr}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="corosync latency" value={`${latency.toFixed(latency < 1 ? 2 : 1)} ms`} tone={fence ? "bad" : latency > 2 ? "warn" : "good"} />
        <Stat label="token / quorum" value={fence ? "lost" : "stable"} tone={fence ? "bad" : "good"} />
        <Stat label="HA nodes" value={fence ? "self-fence" : "healthy"} tone={fence ? "bad" : "good"} />
      </div>
      <p className={clsx("mt-3 text-[13px] leading-relaxed", fence ? "text-bad" : "text-muted")}>
        {fence
          ? "Corosync misses its token timeout. With HA enabled, a node that loses quorum stops feeding its watchdog and reboots: a storage storm just took down healthy VMs."
          : layout === "converged"
            ? "Fine while idle. Now turn on a recovery and a migration at the same time."
            : "Bulk traffic can saturate its own links without touching corosync. Give corosync two links (link0, link1) on separate NICs, so it fails over by itself."}
      </p>
    </Panel>
  );
}

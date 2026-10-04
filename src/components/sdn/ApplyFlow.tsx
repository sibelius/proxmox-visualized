"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Panel } from "../ui";

const STEPS = [
  {
    title: "Edit",
    where: "/etc/pve/sdn/{zones,vnets,subnets,controllers}.cfg",
    text: "Creating a zone, VNet or subnet in the GUI (or with pvesh/API) only writes these files in pmxcfs. They are replicated to all nodes at once, but nothing on the network changes yet: the GUI shows the objects as pending.",
  },
  {
    title: "Apply",
    where: "PUT /cluster/sdn  ·  /etc/pve/sdn/.running-config",
    text: "Clicking Apply (or running pvesh set /cluster/sdn) takes a snapshot of the pending config as the new running config and tells every node to reload its network.",
  },
  {
    title: "Generate",
    where: "/etc/network/interfaces.d/sdn  ·  /etc/frr/frr.conf",
    text: "Each node renders its own part: bridges, VLAN and VXLAN devices, VRFs and gateway IPs go into interfaces.d/sdn; EVPN zones and fabrics also get an FRR configuration. That is why /etc/network/interfaces must end with source /etc/network/interfaces.d/*.",
  },
  {
    title: "Reload",
    where: "ifreload -a  ·  systemctl reload frr",
    text: "ifupdown2 compares the desired and the current state and changes only the difference. Running guests stay connected. Afterwards a VM NIC can use bridge=vnet1, just like a normal bridge.",
  },
];

export function ApplyFlow() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2600);
    return () => clearInterval(t);
  }, [auto]);

  return (
    <Panel
      title="From a click to a running VNet"
      right={
        <Button variant="ghost" onClick={() => setAuto((a) => !a)}>
          {auto ? "❚❚ Pause" : "▶ Play"}
        </Button>
      }
    >
      <ol className="grid gap-2 sm:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => {
                setAuto(false);
                setStep(i);
              }}
              className={clsx(
                "w-full rounded-lg border px-3 py-2 text-left transition",
                i === step ? "border-accent bg-accent/10" : i < step ? "border-line bg-panel-2/60" : "border-line bg-bg hover:border-faint",
              )}
            >
              <div className="font-mono text-[10px] text-faint">step {i + 1}</div>
              <div className={clsx("text-sm font-medium", i === step ? "text-accent" : "text-ink")}>{s.title}</div>
            </button>
          </li>
        ))}
      </ol>
      <div key={step} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] animate-rise">
        <div>
          <div className="font-mono text-[11.5px] text-ink">{STEPS[step].where}</div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{STEPS[step].text}</p>
        </div>
        <div className="grid grid-cols-3 gap-2" aria-label="node states">
          {["pve1", "pve2", "pve3"].map((n, i) => {
            const state = step === 0 ? "pending" : step === 1 ? "notified" : step === 2 ? "rendering" : "applied";
            return (
              <div key={n} className="rounded-lg border border-line bg-bg p-2 text-center" style={{ transitionDelay: `${i * 120}ms` }}>
                <div className="font-mono text-xs text-ink">{n}</div>
                <div
                  className={clsx(
                    "mt-1 font-mono text-[10px]",
                    state === "applied" ? "text-ok" : state === "pending" ? "text-warn" : "text-info animate-pulse-soft",
                  )}
                >
                  {state}
                </div>
                <div className={clsx("mx-auto mt-2 h-1.5 w-full rounded-full transition-all duration-700", state === "applied" ? "bg-ok" : "bg-line")} />
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

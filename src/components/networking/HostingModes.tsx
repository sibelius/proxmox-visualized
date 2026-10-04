"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Callout, Panel, Segmented } from "../ui";

type Mode = "bridged" | "routed" | "nat";

const MODES: Record<Mode, { title: string; verdict: { tone: "ok" | "bad" | "warn"; text: string }; why: string }> = {
  bridged: {
    title: "Bridged",
    verdict: { tone: "bad", text: "Blocked at a typical dedicated-server hoster" },
    why: "VM frames reach the hoster's switch with the VM's own MAC address. Most hosters only accept the server's registered MAC (or require you to request a virtual MAC per IP) and silently drop the rest. Perfect on your own LAN, where you control the switch.",
  },
  routed: {
    title: "Routed",
    verdict: { tone: "ok", text: "Works: the switch only ever sees the host's MAC" },
    why: "The host is a router. VMs get public IPs from an extra subnet routed to the host's main IP; vmbr0 has no physical port. With proxy_arp the host answers ARP for the VM IPs, and ip_forward moves packets between eno1 and vmbr0.",
  },
  nat: {
    title: "Masquerade (NAT)",
    verdict: { tone: "warn", text: "Works with one public IP; inbound needs port forwards" },
    why: "VMs live on a private bridge (10.10.10.0/24). Outgoing traffic is rewritten to the host's single public IP by an iptables MASQUERADE rule. Nothing reaches a VM from outside unless you add DNAT port forwards.",
  },
};

export function HostingModes({ snippets }: { snippets: Record<Mode, ReactNode> }) {
  const [mode, setMode] = useState<Mode>("routed");
  const m = MODES[mode];
  const vmIp = mode === "nat" ? "10.10.10.2" : "203.0.113.18";
  const wireSrc = mode === "bridged" ? "MAC BC:24:11:… (VM)" : mode === "routed" ? "MAC of eno1 (host)" : "MAC of eno1 (host)";
  const wireIp = mode === "nat" ? "src 198.51.100.5 (host)" : "src 203.0.113.18 (VM)";
  const blocked = mode === "bridged";

  return (
    <Panel title="One public server, several VMs" right={<Segmented<Mode> value={mode} onChange={setMode} options={[{ value: "bridged", label: "bridged" }, { value: "routed", label: "routed" }, { value: "nat", label: "masquerade" }]} />}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <svg viewBox="0 0 360 250" className="w-full" role="img" aria-label={`${m.title} setup diagram`}>
            {/* internet + hoster switch */}
            <rect x="130" y="6" width="100" height="30" rx="8" fill="var(--color-panel-2)" stroke="var(--color-line)" />
            <text x="180" y="25" textAnchor="middle" className="fill-muted text-[11px]">internet</text>
            <rect x="110" y="56" width="140" height="30" rx="8" fill="var(--color-panel-2)" stroke={blocked ? "var(--color-bad)" : "var(--color-line)"} />
            <text x="180" y="75" textAnchor="middle" className="fill-ink text-[11px]">hoster switch</text>
            <line x1="180" y1="36" x2="180" y2="56" stroke="var(--color-line)" strokeWidth="2" />
            {/* host */}
            <rect x="20" y="108" width="320" height="132" rx="12" fill="none" stroke="var(--color-accent)" strokeOpacity=".5" />
            <text x="32" y="124" className="fill-accent text-[10px] font-mono">pve host</text>
            <rect x="130" y="112" width="100" height="26" rx="6" fill="var(--color-panel-2)" stroke="var(--color-line)" />
            <text x="180" y="129" textAnchor="middle" className="fill-ink font-mono text-[10px]">eno1 198.51.100.5</text>
            <line x1="180" y1="86" x2="180" y2="112" stroke={blocked ? "var(--color-bad)" : "var(--color-ok)"} strokeWidth="2" strokeDasharray="6 6" className="animate-dash" />
            {blocked && <text x="196" y="102" className="fill-bad text-[14px] font-bold">✕</text>}
            {/* routing box */}
            <rect x="110" y="150" width="140" height="24" rx="6" fill={mode === "bridged" ? "transparent" : "color-mix(in srgb, var(--color-accent) 15%, transparent)"} stroke="var(--color-line)" strokeDasharray={mode === "bridged" ? "3 3" : undefined} />
            <text x="180" y="166" textAnchor="middle" className="fill-muted font-mono text-[10px]">
              {mode === "bridged" ? "bridge-ports eno1 (L2)" : mode === "routed" ? "ip_forward + proxy_arp" : "MASQUERADE → eno1"}
            </text>
            <line x1="180" y1="138" x2="180" y2="150" stroke="var(--color-line)" strokeWidth="2" />
            <rect x="80" y="184" width="200" height="22" rx="6" fill="var(--color-panel-2)" stroke="var(--color-line)" />
            <text x="180" y="199" textAnchor="middle" className="fill-ink font-mono text-[10px]">
              {mode === "nat" ? "vmbr1 10.10.10.1/24" : mode === "routed" ? "vmbr0 203.0.113.17/28" : "vmbr0"}
            </text>
            <line x1="180" y1="174" x2="180" y2="184" stroke="var(--color-line)" strokeWidth="2" />
            {[0, 1].map((i) => (
              <g key={i}>
                <line x1={130 + i * 100} y1="206" x2={130 + i * 100} y2="214" stroke="var(--color-line)" strokeWidth="2" />
                <rect x={88 + i * 100} y="214" width="84" height="20" rx="5" fill="var(--color-bg)" stroke="var(--color-f1)" strokeOpacity=".6" />
                <text x={130 + i * 100} y="228" textAnchor="middle" className="fill-f1 font-mono text-[9.5px]">
                  {mode === "nat" ? `10.10.10.${2 + i}` : `203.0.113.${18 + i}`}
                </text>
              </g>
            ))}
          </svg>
          <div className="mt-2 rounded-lg border border-line bg-bg p-2 font-mono text-[11px] text-muted">
            <div className="text-faint">frame from VM {vmIp} as the hoster sees it:</div>
            <div className={clsx(blocked ? "text-bad" : "text-ok")}>
              {wireSrc} · {wireIp}
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Callout tone={m.verdict.tone} title={m.verdict.text}>
            {m.why}
          </Callout>
          <div key={mode} className="animate-rise">{snippets[mode]}</div>
        </div>
      </div>
    </Panel>
  );
}

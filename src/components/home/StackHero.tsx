"use client";

import { useState } from "react";
import Link from "next/link";

type Box = { id: string; x: number; y: number; w: number; h: number; label: string; sub?: string; color: string; href: string; caption: string };

const L = 16; // left edge
const W = 560; // stack width

const BOXES: Box[] = [
  { id: "ui", x: L, y: 14, w: W, h: 34, label: "Web UI · REST /api2/json · qm · pct · pvesh", color: "#e7e9f0", href: "/api", caption: "Every click, CLI command and Terraform run is the same REST call, checked against the same ACLs." },
  { id: "svc", x: L, y: 56, w: W, h: 34, label: "pveproxy :8006 · pvedaemon · pvestatd · pvescheduler · pve-ha-*", color: "#e57000", href: "/architecture", caption: "A handful of daemons: an unprivileged HTTPS proxy, a root worker, status, scheduling and HA." },
  { id: "cfs", x: L, y: 98, w: W, h: 34, label: "pmxcfs  /etc/pve  (replicated config, SQLite + corosync)", color: "#fbbf24", href: "/cluster", caption: "A tiny replicated file system: every node sees every guest config; quorum guards writes." },
  { id: "kvm", x: L, y: 140, w: 134, h: 46, label: "KVM / QEMU", sub: "VMs", color: "#e57000", href: "/vms-vs-containers", caption: "Each VM is one kvm process with its own kernel and virtual hardware." },
  { id: "lxc", x: L + 142, y: 140, w: 134, h: 46, label: "LXC", sub: "containers", color: "#34d399", href: "/vms-vs-containers", caption: "Containers are process trees on the host kernel, fenced by namespaces and cgroups." },
  { id: "sto", x: L + 284, y: 140, w: 134, h: 46, label: "Storage", sub: "ZFS · LVM · Ceph", color: "#a78bfa", href: "/storage", caption: "Pluggable storage: local LVM-thin and ZFS, shared NFS and Ceph, backups to PBS." },
  { id: "net", x: L + 426, y: 140, w: 134, h: 46, label: "Network", sub: "bridges · SDN", color: "#22d3ee", href: "/networking", caption: "Linux bridges, VLANs and bonds, plus SDN zones (VXLAN, EVPN) and a firewall." },
  { id: "os", x: L, y: 194, w: W, h: 34, label: "Debian 13 + proxmox-kernel 6.x", color: "#38bdf8", href: "/architecture", caption: "Plain Debian userland with an Ubuntu-derived kernel that has ZFS built in." },
  { id: "hw", x: L, y: 236, w: W, h: 26, label: "x86-64 hardware (VT-x / AMD-V)", color: "#5a6275", href: "/architecture", caption: "Hardware virtualization runs guest code natively; KVM only handles the traps." },
];

const NODES = [
  { x: 700, y: 60, name: "pve1" },
  { x: 880, y: 60, name: "pve2" },
  { x: 790, y: 210, name: "pve3" },
];

const RING = `M ${NODES[0].x} ${NODES[0].y} L ${NODES[1].x} ${NODES[1].y} L ${NODES[2].x} ${NODES[2].y} Z`;

export function StackHero() {
  const [hot, setHot] = useState<string | null>(null);
  const cap = hot === "cluster" ? "Nodes vote over corosync; pmxcfs replicates /etc/pve to all of them; HA restarts guests elsewhere if a node dies." : BOXES.find((b) => b.id === hot)?.caption;

  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox="0 0 960 274" className="min-w-[680px]" role="img" aria-label="The Proxmox VE stack on one node, and three nodes forming a cluster">
          <defs>
            <path id="hero-req" d={`M ${L + 40} 31 V 163`} />
            <path id="hero-ring" d={RING} />
          </defs>

          {/* request pulse going down the stack */}
          <use href="#hero-req" stroke="#e5700044" strokeWidth={2} strokeDasharray="3 5" fill="none" />

          {BOXES.map((b) => {
            const on = hot === b.id;
            return (
              <Link key={b.id} href={b.href} aria-label={b.label}>
                <g onMouseEnter={() => setHot(b.id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(b.id)} className="cursor-pointer">
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill={on ? `${b.color}22` : "#171b24"} stroke={on ? b.color : "#242a38"} style={{ transition: "all 200ms" }} />
                  <rect x={b.x} y={b.y} width={3} height={b.h} rx={1.5} fill={b.color} />
                  {b.sub ? (
                    <>
                      <text x={b.x + b.w / 2} y={b.y + 20} textAnchor="middle" fill="#e7e9f0" fontSize={12.5} fontWeight={600}>
                        {b.label}
                      </text>
                      <text x={b.x + b.w / 2} y={b.y + 36} textAnchor="middle" fill="#8a93a8" fontSize={10.5}>
                        {b.sub}
                      </text>
                    </>
                  ) : (
                    <text x={b.x + 14} y={b.y + b.h / 2 + 4} fill={b.id === "hw" ? "#8a93a8" : "#e7e9f0"} fontSize={12} fontFamily="var(--font-mono)">
                      {b.label}
                    </text>
                  )}
                </g>
              </Link>
            );
          })}

          {/* guests blinking inside KVM and LXC */}
          {[0, 1, 2].map((i) => (
            <rect key={`v${i}`} x={L + 134 - 11 - i * 8} y={176} width={5} height={5} rx={1.5} fill="#e57000">
              <animate attributeName="opacity" values="1;.35;1" dur={`${2 + i * 0.7}s`} repeatCount="indefinite" />
            </rect>
          ))}
          {[0, 1, 2, 3].map((i) => (
            <rect key={`c${i}`} x={L + 142 + 134 - 11 - i * 8} y={176} width={5} height={5} rx={1.5} fill="#34d399">
              <animate attributeName="opacity" values="1;.35;1" dur={`${1.6 + i * 0.5}s`} repeatCount="indefinite" />
            </rect>
          ))}

          <circle r={4.5} fill="#e57000">
            <animateMotion dur="2.6s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
              <mpath href="#hero-req" />
            </animateMotion>
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.85;1" dur="2.6s" repeatCount="indefinite" />
          </circle>

          {/* the stack × 3 = cluster */}
          <text x={604} y={136} fill="#5a6275" fontSize={20}>
            ×3
          </text>
          <g onMouseEnter={() => setHot("cluster")} onMouseLeave={() => setHot(null)}>
            <Link href="/cluster" aria-label="Cluster and quorum">
              <use href="#hero-ring" fill="#fbbf2408" stroke="#fbbf24" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="6 6" className="animate-dash" />
              {[0, 0.33, 0.66].map((d) => (
                <circle key={d} r={3.5} fill="#fbbf24">
                  <animateMotion dur="3.6s" begin={`${d * 3.6}s`} repeatCount="indefinite">
                    <mpath href="#hero-ring" />
                  </animateMotion>
                </circle>
              ))}
              {NODES.map((n, i) => (
                <g key={n.name}>
                  <rect x={n.x - 52} y={n.y - 30} width={104} height={60} rx={10} fill="#11141b" stroke={hot === "cluster" ? "#fbbf24" : "#242a38"} />
                  <text x={n.x - 40} y={n.y - 11} fill="#e7e9f0" fontSize={12} fontFamily="var(--font-mono)">
                    {n.name}
                  </text>
                  <text x={n.x - 40} y={n.y + 4} fill="#8a93a8" fontSize={9.5} fontFamily="var(--font-mono)">
                    /etc/pve ✓
                  </text>
                  {Array.from({ length: 3 + i }).map((_, k) => (
                    <rect key={k} x={n.x - 40 + k * 11} y={n.y + 11} width={8} height={8} rx={2} fill={k % 2 ? "#34d399" : "#e57000"} opacity={0.85} />
                  ))}
                </g>
              ))}
              <text x={790} y={262} textAnchor="middle" fill="#8a93a8" fontSize={11}>
                corosync quorum · /etc/pve replicated
              </text>
            </Link>
          </g>
        </svg>
      </div>
      <p className="mt-2 min-h-[2.5em] text-sm leading-relaxed text-muted">
        {cap ?? "One node is Debian plus KVM, LXC and a replicated config file system behind a single API. Three of them form a cluster. Hover a layer, click to dive in."}
      </p>
    </div>
  );
}

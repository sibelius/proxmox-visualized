"use client";

import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button, Panel, Pill, Segmented, Slider } from "../ui";

export type Zone = "simple" | "vlan" | "qinq" | "vxlan" | "evpn";

const ZONES: Record<Zone, { label: string; overhead: number; summary: string; reach: boolean }> = {
  simple: {
    label: "Simple",
    overhead: 0,
    reach: false,
    summary:
      "An isolated bridge on each node, with the subnet gateway IP on it and optional SNAT to the outside. Nothing connects the bridges between nodes: VMs on different nodes cannot talk at layer 2. Good for a single node, a lab, or NAT-only networks with dnsmasq DHCP.",
  },
  vlan: {
    label: "VLAN",
    overhead: 0,
    reach: true,
    summary:
      "The VNet is a VLAN on an existing bridge (vmbr0) that must exist on every node. The physical switch does the work: its trunk ports must carry the VLAN. The simplest way to manage VLANs for the whole cluster from one place.",
  },
  qinq: {
    label: "QinQ",
    overhead: 4,
    reach: true,
    summary:
      "VLAN stacking: the zone has a service VLAN (outer S-tag), each VNet adds its own customer VLAN (inner C-tag). Lets a provider give each tenant its own 4094 VLANs inside one outer tag. Needs 4 bytes of MTU.",
  },
  vxlan: {
    label: "VXLAN",
    overhead: 50,
    reach: true,
    summary:
      "Layer 2 over layer 3: each Ethernet frame is wrapped in UDP (port 4789) and sent to the other nodes' IPs from the zone's peer list. The underlay only needs IP connectivity, no VLANs. Flooding (broadcast, unknown unicast) is copied to every peer.",
  },
  evpn: {
    label: "EVPN",
    overhead: 50,
    reach: true,
    summary:
      "VXLAN data plane plus a BGP EVPN control plane (FRR). Nodes announce which MAC/IP lives behind which VTEP instead of learning by flooding. Every node routes for the VNet with the same anycast gateway IP and MAC, and exit nodes connect the zone to the outside.",
  },
};

const NODE_X = [20, 240, 460];
const NODE_W = 180;
const CX = (i: number) => NODE_X[i] + NODE_W / 2;

export function ZoneTopology({ configs }: { configs: Record<Zone, ReactNode> }) {
  const [zone, setZone] = useState<Zone>("vxlan");
  const [vm200On, setVm200On] = useState(1); // node index
  const [mtu, setMtu] = useState(1500);
  const [vni, setVni] = useState(100000);
  const [run, setRun] = useState(0);
  const z = ZONES[zone];
  const overlay = zone === "vxlan" || zone === "evpn";
  const dstNode = zone === "evpn" ? vm200On : 1;

  const packetPath = useMemo(() => {
    const a = CX(0);
    const b = CX(dstNode);
    if (!z.reach) return `M ${a} 66 L ${a} 124 L ${a} 182`;
    return `M ${a} 66 L ${a} 124 L ${a} 182 L ${a} 256 L ${b} 256 L ${b} 182 L ${b} 124 L ${b} 66`;
  }, [z.reach, dstNode]);

  const bridgeLabel = () =>
    zone === "simple"
      ? "vnet1 · gw 10.0.20.1"
      : zone === "vlan"
        ? "vnet1 → vmbr0 VLAN 20"
        : zone === "qinq"
          ? "vnet1 → vmbr0 S100 / C20"
          : zone === "vxlan"
            ? "vnet1 + vxlan_vnet1"
            : "vnet1 · anycast gw .1";

  const uplinkLabel = (i: number) => (overlay ? `VTEP 10.10.5.1${i + 1}` : zone === "simple" ? "vmbr0 (SNAT out)" : "vmbr0 → bond0 trunk");

  const wireLabel =
    zone === "vlan"
      ? "trunk: 802.1Q VID 20"
      : zone === "qinq"
        ? "802.1ad S-tag 100 + 802.1Q C-tag 20"
        : zone === "simple"
          ? "no L2 path between nodes"
          : `routed underlay · UDP 4789 · VNI ${vni}`;

  return (
    <div className="space-y-4">
      <Panel
        title="Two VMs in vnet1 (10.0.20.0/24) on different nodes"
        right={
          <Segmented<Zone>
            value={zone}
            onChange={(v) => {
              setZone(v);
              setRun((r) => r + 1);
            }}
            options={(Object.keys(ZONES) as Zone[]).map((k) => ({ value: k, label: ZONES[k].label }))}
          />
        }
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div>
            <svg viewBox="0 0 660 290" className="w-full" role="img" aria-label={`${z.label} zone topology across three nodes`}>
              {/* BGP sessions for EVPN */}
              {zone === "evpn" &&
                [
                  [0, 1],
                  [1, 2],
                  [0, 2],
                ].map(([a, b]) => (
                  <path
                    key={`${a}${b}`}
                    d={`M ${CX(a)} 20 Q ${(CX(a) + CX(b)) / 2} ${b - a === 2 ? -26 : -6} ${CX(b)} 20`}
                    fill="none"
                    stroke="var(--color-accent-2)"
                    strokeWidth="1.5"
                    strokeDasharray="5 5"
                    className="animate-dash"
                  />
                ))}
              {zone === "evpn" && (
                <text x="330" y="10" textAnchor="middle" className="fill-accent-2 font-mono text-[10px]">
                  BGP EVPN sessions (FRR)
                </text>
              )}
              {/* underlay */}
              <rect x="20" y="244" width="620" height="24" rx="6" fill="var(--color-panel-2)" stroke={zone === "simple" ? "var(--color-line)" : "var(--color-accent)"} strokeOpacity=".6" />
              <text x="330" y="260" textAnchor="middle" className={clsx("font-mono text-[10.5px]", zone === "simple" ? "fill-faint" : "fill-accent")}>
                {wireLabel}
              </text>
              {NODE_X.map((x, i) => {
                const hasVm100 = i === 0;
                const hasVm200 = zone === "evpn" ? i === vm200On : i === 1;
                return (
                  <g key={i}>
                    <rect x={x} y="20" width={NODE_W} height="192" rx="12" fill="var(--color-panel-2)" fillOpacity=".4" stroke="var(--color-line)" />
                    <text x={x + 10} y="36" className="fill-muted font-mono text-[11px]">
                      pve{i + 1}
                    </text>
                    {zone === "evpn" && i === 2 && (
                      <text x={x + NODE_W - 10} y="36" textAnchor="end" className="fill-warn font-mono text-[9.5px]">
                        exit node
                      </text>
                    )}
                    {(hasVm100 || hasVm200) && (
                      <g className="animate-rise">
                        <rect x={x + 30} y="46" width={NODE_W - 60} height="38" rx="8" fill="var(--color-bg)" stroke="var(--color-f1)" />
                        <text x={CX(i)} y="62" textAnchor="middle" className="fill-f1 font-mono text-[11px]">
                          {hasVm100 ? "VM 100" : "VM 200"}
                        </text>
                        <text x={CX(i)} y="76" textAnchor="middle" className="fill-muted font-mono text-[9.5px]">
                          {hasVm100 ? "10.0.20.10" : "10.0.20.20"}
                        </text>
                      </g>
                    )}
                    <line x1={CX(i)} y1="84" x2={CX(i)} y2="112" stroke="var(--color-line)" strokeWidth="2" />
                    <rect x={x + 12} y="112" width={NODE_W - 24} height="26" rx="6" fill="var(--color-bg)" stroke="var(--color-accent)" strokeOpacity=".7" />
                    <text x={CX(i)} y="129" textAnchor="middle" className="fill-ink font-mono text-[10px]">
                      {bridgeLabel()}
                    </text>
                    <line x1={CX(i)} y1="138" x2={CX(i)} y2="170" stroke="var(--color-line)" strokeWidth="2" />
                    <rect x={x + 22} y="170" width={NODE_W - 44} height="24" rx="6" fill="var(--color-bg)" stroke="var(--color-line)" />
                    <text x={CX(i)} y="186" textAnchor="middle" className="fill-muted font-mono text-[10px]">
                      {uplinkLabel(i)}
                    </text>
                    <line x1={CX(i)} y1="194" x2={CX(i)} y2="244" stroke={zone === "simple" ? "var(--color-line)" : "var(--color-faint)"} strokeWidth="2" strokeDasharray={zone === "simple" ? "3 4" : undefined} />
                  </g>
                );
              })}
              {zone === "simple" && (
                <g>
                  <text x={CX(0) + 16} y="222" className="fill-bad text-[16px] font-bold">
                    ✕
                  </text>
                  <text x={CX(1)} y="232" textAnchor="middle" className="fill-bad font-mono text-[10px]">
                    VM 200 unreachable at L2
                  </text>
                </g>
              )}
              {/* packet */}
              <g key={`${zone}-${dstNode}-${run}`}>
                <circle r="6" fill={z.reach ? "var(--color-warn)" : "var(--color-bad)"}>
                  <animateMotion dur={z.reach ? "3s" : "1.4s"} repeatCount="indefinite" path={packetPath} />
                </circle>
              </g>
            </svg>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {zone === "evpn" && (
                <Button onClick={() => setVm200On((n) => (n === 1 ? 2 : 1))}>⇄ live-migrate VM 200 to pve{vm200On === 1 ? 3 : 2}</Button>
              )}
              <Pill color="var(--color-accent)">VNet MTU {mtu - z.overhead}</Pill>
              {z.overhead > 0 && <span className="text-xs text-faint">underlay {mtu} − {z.overhead} bytes of headers</span>}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <p key={zone} className="text-[13px] leading-relaxed text-muted animate-rise">
              {z.summary}
            </p>
            <Slider label="underlay MTU" value={mtu} min={1500} max={9000} step={500} onChange={setMtu} />
            {zone === "evpn" && <EvpnRoutes vm200On={vm200On} />}
            {(zone === "vlan" || zone === "qinq") && (
              <p className="text-xs text-faint">
                The switch learns the VM MACs per VLAN as usual. Proxmox only makes sure every node puts the same tag(s) on the
                VM&apos;s port.
              </p>
            )}
          </div>
        </div>
      </Panel>

      <WireFormat zone={zone} vni={vni} setVni={setVni} />

      <div key={zone} className="animate-rise">
        {configs[zone]}
      </div>
    </div>
  );
}

function EvpnRoutes({ vm200On }: { vm200On: number }) {
  const routes = [
    { t: 2, what: "BC:24:11:00:01:00 / 10.0.20.10", via: "10.10.5.11", local: true },
    { t: 2, what: "BC:24:11:00:02:00 / 10.0.20.20", via: `10.10.5.1${vm200On + 1}`, local: false, moved: true },
    { t: 3, what: "IMET (flood list) VNI 100000", via: "10.10.5.12, .13", local: false },
    { t: 5, what: "0.0.0.0/0 (default via exit node)", via: "10.10.5.13", local: false },
  ];
  return (
    <div className="rounded-lg border border-line bg-bg p-2">
      <div className="mb-1 font-mono text-[10.5px] text-faint">pve1 · vtysh -c &quot;show bgp l2vpn evpn&quot; (simplified)</div>
      <table className="w-full font-mono text-[10.5px]">
        <tbody>
          {routes.map((r, i) => (
            <tr key={`${i}-${r.via}`} className={clsx(r.moved && "animate-flash")}>
              <td className="pr-2 text-accent-2">type-{r.t}</td>
              <td className="pr-2 text-muted">{r.what}</td>
              <td className={clsx("text-right", r.local ? "text-faint" : "text-ink")}>{r.local ? "local" : r.via}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
        After a migration the new node announces VM 200&apos;s MAC/IP with a higher MAC-mobility sequence number and every
        node updates its forwarding at once, without waiting for ARP caches or flooding.
      </p>
    </div>
  );
}

/* ---------- wire format ---------- */

type Field = { name: string; bytes: number; color: string; detail: string };

function fieldsFor(zone: Zone, vni: number): Field[] {
  const inner: Field[] = [
    { name: "Eth", bytes: 14, color: "var(--color-f1)", detail: "dst/src MAC of VM 200 / VM 100, EtherType 0x0800" },
    { name: "IP + TCP + data", bytes: 0, color: "var(--color-panel-2)", detail: "the VM's packet, untouched" },
  ];
  if (zone === "vlan")
    return [inner[0], { name: "802.1Q", bytes: 4, color: "var(--color-warn)", detail: "TPID 0x8100 · PCP · VID 20" }, inner[1]];
  if (zone === "qinq")
    return [
      inner[0],
      { name: "S-tag", bytes: 4, color: "var(--color-f5)", detail: "TPID 0x88a8 (vlan-protocol 802.1ad) · VID 100, the zone's service VLAN" },
      { name: "C-tag", bytes: 4, color: "var(--color-warn)", detail: "TPID 0x8100 · VID 20, the VNet's tag" },
      inner[1],
    ];
  if (zone === "simple") return inner;
  return [
    { name: "outer Eth", bytes: 14, color: "var(--color-f4)", detail: "MACs of the two hosts' NICs (or next-hop router)" },
    { name: "outer IPv4", bytes: 20, color: "var(--color-f6)", detail: "src 10.10.5.11 → dst VTEP of the target node" },
    { name: "UDP", bytes: 8, color: "var(--color-f2)", detail: "dst port 4789; src port = hash of the inner flow, so underlay ECMP/LACP still spreads flows" },
    { name: "VXLAN", bytes: 8, color: "var(--color-accent)", detail: `flags 0x08 (I bit) · VNI ${vni}` },
    { ...inner[0], name: "inner Eth" },
    inner[1],
  ];
}

function WireFormat({ zone, vni, setVni }: { zone: Zone; vni: number; setVni: (n: number) => void }) {
  const fields = fieldsFor(zone, vni);
  const [hover, setHover] = useState<number | null>(null);
  const added = fields.filter((f) => f.name !== "IP + TCP + data" && !f.name.includes("Eth")).reduce((a, f) => a + f.bytes, 0) + (zone === "vxlan" || zone === "evpn" ? 14 : 0);
  const overlay = zone === "vxlan" || zone === "evpn";
  const vniBits = vni.toString(2).padStart(24, "0").slice(-24);

  return (
    <Panel title="The frame on the wire between pve1 and pve2" right={<span className="font-mono text-[11px] text-faint">+{added} bytes vs. the VM&apos;s frame</span>}>
      <div className="flex overflow-hidden rounded-lg border border-line" role="list">
        {fields.map((f, i) => (
          <div
            key={`${zone}-${f.name}`}
            role="listitem"
            tabIndex={0}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={clsx("min-w-0 border-r border-line px-1.5 py-2 text-center transition last:border-r-0 animate-rise", hover === i && "brightness-125")}
            style={{
              flex: f.bytes ? `${f.bytes} 0 0` : "40 0 0",
              background: `color-mix(in srgb, ${f.color} ${f.bytes ? 22 : 100}%, transparent)`,
              animationDelay: `${i * 60}ms`,
            }}
          >
            <div className="truncate font-mono text-[10.5px] text-ink">{f.name}</div>
            <div className="font-mono text-[10px] text-muted">{f.bytes ? `${f.bytes} B` : "≤ MTU"}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 min-h-10 text-[13px] text-muted">
        {hover != null ? (
          <>
            <span className="font-mono text-ink">{fields[hover].name}</span>: {fields[hover].detail}
          </>
        ) : zone === "simple" ? (
          "Simple zones never put VNet frames on the wire. Traffic leaves the node only after being routed (and usually SNATed) by the host."
        ) : (
          "Hover a header to see what it carries."
        )}
      </p>
      {overlay && (
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <div className="mb-1 font-mono text-[10.5px] text-faint">VXLAN header, RFC 7348 (8 bytes = 2 × 32 bits)</div>
            <div className="grid grid-cols-32 overflow-hidden rounded border border-line font-mono text-[9px]" style={{ gridTemplateColumns: "repeat(32, minmax(0, 1fr))" }}>
              {"00001000".split("").map((b, i) => (
                <span key={`f${i}`} className={clsx("border-r border-line/50 py-1 text-center", i === 4 ? "bg-accent/40 text-ink" : "bg-accent/10 text-muted")}>
                  {b}
                </span>
              ))}
              <span className="col-span-24 bg-panel-2 py-1 text-center text-faint" style={{ gridColumn: "span 24" }}>
                reserved (24)
              </span>
              {vniBits.split("").map((b, i) => (
                <span key={`v${i}`} className={clsx("border-r border-line/40 py-1 text-center", b === "1" ? "bg-f2/30 text-ink" : "bg-f2/5 text-faint")}>
                  {b}
                </span>
              ))}
              <span className="bg-panel-2 py-1 text-center text-faint" style={{ gridColumn: "span 8" }}>
                rsvd
              </span>
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
              <span>flags · I bit = VNI valid</span>
              <span>VNI (24 bits): 16,777,216 networks vs 4094 VLANs</span>
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            VNet tag (VNI)
            <input
              type="number"
              min={1}
              max={16777215}
              value={vni}
              onChange={(e) => setVni(Math.max(1, Math.min(16777215, Number(e.target.value) || 1)))}
              className="w-32 rounded-md border border-line bg-bg px-2 py-1 font-mono text-sm text-ink"
            />
            <span className="font-mono text-[10px] text-faint">0x{vni.toString(16).padStart(6, "0")}</span>
          </label>
        </div>
      )}
      {overlay && (
        <p className="mt-3 text-xs text-faint">
          14 + 20 + 8 + 8 = 50 bytes of new headers. The outer IP packet must fit the underlay MTU, so the VNet&apos;s MTU
          (and the guests&apos;) must be 50 bytes smaller, or the underlay MTU 50 bytes larger. Otherwise large packets
          fail while ping and SSH still work.
        </p>
      )}
    </Panel>
  );
}

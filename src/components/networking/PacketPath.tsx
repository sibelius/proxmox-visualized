"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Button, Panel, Pill, Segmented, Toggle } from "../ui";

type BondMode = "none" | "active-backup" | "balance-alb" | "802.3ad";

type Hop = {
  id: string;
  name: string;
  kind: string;
  note: string;
  tagged: boolean;
  /** "add" | "strip" marks where the 802.1Q header changes */
  change?: "add" | "classify";
  color: string;
};

const BOND_INFO: Record<BondMode, { label: string; switchNeeds: string; tone: "ok" | "warn" | "info" }> = {
  none: {
    label: "single NIC",
    switchNeeds: "Any access/trunk port. One cable = one failure domain.",
    tone: "warn",
  },
  "active-backup": {
    label: "active-backup (mode 1)",
    switchNeeds:
      "Nothing special: two plain ports (even on two unstacked switches). Only one link carries traffic; the other waits. The only mode Proxmox supports for a bond carrying corosync.",
    tone: "ok",
  },
  "balance-alb": {
    label: "balance-alb (mode 6)",
    switchNeeds:
      "No switch config, but the bond rewrites source MACs in ARP replies to spread receive traffic. Behind a bridge full of VM MACs this is fragile; prefer LACP or active-backup.",
    tone: "warn",
  },
  "802.3ad": {
    label: "802.3ad LACP (mode 4)",
    switchNeeds:
      "The switch ports must be in one LACP port-channel (or MLAG across two switches). Each flow is hashed to ONE link: a single TCP stream never exceeds one NIC's speed.",
    tone: "info",
  },
};

export function PacketPath() {
  const [bond, setBond] = useState<BondMode>("802.3ad");
  const [vlanAware, setVlanAware] = useState(true);
  const [tag, setTag] = useState(true);
  const [fw, setFw] = useState(true);
  const [jumbo, setJumbo] = useState(false);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  const uplink = bond === "none" ? "eno1" : "bond0";

  const hops = useMemo<Hop[]>(() => {
    const h: Hop[] = [
      {
        id: "eth0",
        name: "eth0 (inside VM 100)",
        kind: "virtio-net",
        note: "The guest sends a plain Ethernet frame. It never sees the VLAN tag: tag=20 is enforced by the host, so the guest cannot escape its VLAN.",
        tagged: false,
        color: "var(--color-f1)",
      },
      {
        id: "tap",
        name: "tap100i0",
        kind: "tap device",
        note: "QEMU's end of the virtual cable (vhost-net moves packets in-kernel). Name = tap<vmid>i<netX>.",
        tagged: false,
        color: "var(--color-f1)",
      },
    ];
    if (fw) {
      h.push(
        {
          id: "fwbr",
          name: "fwbr100i0",
          kind: "firewall bridge",
          note: "Per-NIC mini bridge so iptables (br_netfilter) can see the guest's traffic and apply 100.fw rules. Only created for the iptables backend; the nftables proxmox-firewall filters Linux-bridge ports directly.",
          tagged: false,
          color: "var(--color-f5)",
        },
        {
          id: "veth",
          name: "fwln100i0 ⇄ fwpr100p0",
          kind: "veth pair",
          note: "A virtual patch cable from the firewall bridge into the real bridge. fwpr100p0 is the port that is plugged into the bridge.",
          tagged: false,
          color: "var(--color-f5)",
        },
      );
    }
    const port = fw ? "fwpr100p0" : "tap100i0";
    if (tag && !vlanAware) {
      h.push(
        {
          id: "vbr",
          name: "vmbr0v20",
          kind: "auto-created bridge",
          note: `Without a VLAN-aware bridge, Proxmox creates one extra bridge per VLAN when the VM starts and plugs ${port} into it. It is not in /etc/network/interfaces.`,
          tagged: false,
          color: "var(--color-f4)",
        },
        {
          id: "vsub",
          name: `${uplink}.20`,
          kind: "VLAN sub-interface",
          note: `Also auto-created: the 802.1Q header with VID 20 is added here, on egress of ${uplink}.20.`,
          tagged: true,
          change: "add",
          color: "var(--color-f4)",
        },
      );
    } else {
      h.push({
        id: "vmbr",
        name: "vmbr0",
        kind: vlanAware ? "Linux bridge, VLAN-aware" : "Linux bridge",
        note: vlanAware
          ? tag
            ? `${port} is an access port with PVID 20 (untagged): the frame is classified into VLAN 20 inside the bridge. ${uplink} is a trunk port (bridge-vids 2-4094), so the tag is added when the frame leaves through it.`
            : `No tag set: ${port} gets the bridge's default PVID 1, so the frame stays in VLAN 1 and leaves ${uplink} untagged (the switch's native VLAN).`
          : tag
            ? ""
            : "A plain learning switch: looks up the destination MAC and forwards. No VLAN logic at all.",
        tagged: vlanAware && tag,
        change: vlanAware && tag ? "classify" : undefined,
        color: "var(--color-accent)",
      });
    }
    if (bond !== "none") {
      h.push({
        id: "bond",
        name: "bond0",
        kind: BOND_INFO[bond].label,
        note:
          bond === "802.3ad"
            ? "Hashes each flow (layer3+4: IPs + ports) to pick a member link. All packets of one flow stay on one link, so nothing is reordered."
            : bond === "active-backup"
              ? "Sends everything through the active member; MII monitoring flips to the backup in ~100 ms if the carrier drops."
              : "Transmit is balanced by load; receive is balanced by answering ARP with different slave MACs.",
        tagged: tag,
        color: "var(--color-f2)",
      });
    }
    h.push(
      {
        id: "nic",
        name: bond === "none" ? "eno1" : "eno1 / eno2",
        kind: "physical NICs",
        note: jumbo
          ? "MTU 9000 on the NIC, bond and bridge. The switch must allow ≥ 9000 too, or big frames vanish silently."
          : "MTU 1500 (default). Frames with a tag are 1522 bytes on the wire; every switch handles that.",
        tagged: tag,
        color: "var(--color-f6)",
      },
      {
        id: "sw",
        name: "Top-of-rack switch",
        kind: bond === "802.3ad" ? "LACP port-channel" : "switch ports",
        note: tag
          ? "The port must be a trunk that allows VLAN 20. The switch strips/forwards the tag toward the destination in VLAN 20."
          : "Untagged frames land in the port's native/access VLAN.",
        tagged: tag,
        color: "var(--color-muted)",
      },
    );
    return h;
  }, [bond, vlanAware, tag, fw, jumbo, uplink]);

  const n = hops.length;
  const cur = Math.min(step, n - 1);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setStep((s) => (s + 1) % (n + 2)), 1100);
    return () => clearInterval(t);
  }, [playing, n]);

  const config = useMemo(() => buildInterfaces({ bond, vlanAware, jumbo }), [bond, vlanAware, jumbo]);
  const vmLine = `net0: virtio=BC:24:11:5E:7A:01,bridge=vmbr0${fw ? ",firewall=1" : ""}${jumbo ? ",mtu=1" : ""}${tag ? ",tag=20" : ""}`;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <Panel
        title="Packet path: VM 100 → the wire"
        right={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setPlaying((p) => !p)}>
              {playing ? "❚❚ Pause" : "▶ Play"}
            </Button>
            <Button variant="ghost" onClick={() => { setPlaying(false); setStep((s) => (s + 1) % n); }}>
              Step →
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-3">
          <Toggle checked={fw} onChange={setFw} label="guest firewall (firewall=1)" />
          <Toggle checked={vlanAware} onChange={setVlanAware} label="VLAN-aware vmbr0" />
          <Toggle checked={tag} onChange={setTag} label="VM tag=20" />
          <Toggle checked={jumbo} onChange={setJumbo} label="MTU 9000" />
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-faint">uplink:</span>
          <Segmented<BondMode>
            value={bond}
            onChange={setBond}
            options={[
              { value: "none", label: "single NIC" },
              { value: "active-backup", label: "active-backup" },
              { value: "balance-alb", label: "balance-alb" },
              { value: "802.3ad", label: "LACP 802.3ad" },
            ]}
          />
        </div>

        <ol className="relative space-y-2" aria-label="Hops the frame traverses">
          {hops.map((h, i) => {
            const active = i === cur && step < n;
            const passed = i < cur || step >= n;
            return (
              <li
                key={h.id}
                onClick={() => { setPlaying(false); setStep(i); }}
                className={clsx(
                  "relative grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] gap-3 rounded-lg border px-3 py-2 transition",
                  active ? "border-accent/70 bg-accent/5" : "border-line bg-panel-2/40 hover:border-faint",
                )}
              >
                <div className="flex flex-col items-center pt-1">
                  <span
                    className={clsx("size-3 rounded-full border-2 transition", active && "animate-pulse-soft")}
                    style={{
                      borderColor: h.color,
                      background: active || passed ? h.color : "transparent",
                    }}
                  />
                  {i < n - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-ink">{h.name}</span>
                    <span className="text-[11px] text-faint">{h.kind}</span>
                    <span className="ml-auto">
                      <Frame tagged={h.tagged} highlight={active && !!h.change} jumbo={jumbo} />
                    </span>
                  </div>
                  {active && h.note && <p className="mt-1.5 text-[13px] leading-relaxed text-muted animate-rise">{h.note}</p>}
                  {h.change && (
                    <div className="mt-1 font-mono text-[10.5px] text-warn">
                      {h.change === "add" ? "↳ 802.1Q tag VID 20 pushed here" : "↳ classified into VLAN 20 here; tag pushed on egress to the trunk"}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs text-faint">
          The return path is the mirror image: the switch sends VID 20 tagged, the bridge (or {uplink}.20) strips the tag and
          only VM ports in VLAN 20 receive the frame.
        </p>
      </Panel>

      <div className="flex min-w-0 flex-col gap-4">
        <BondLinks mode={bond} />
        <Panel title="/etc/network/interfaces (live)">
          <ConfigView text={config} />
          <div className="mt-3 text-[11px] text-faint">/etc/pve/qemu-server/100.conf</div>
          <pre className="mt-1 overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-[12px] text-ink">{vmLine}</pre>
          {tag && !vlanAware && (
            <p className="mt-2 text-xs text-warn">
              vmbr0v20 and {uplink}.20 are not in the file: Proxmox creates them when the VM starts. One bridge per VLAN
              doesn&apos;t scale to hundreds of VLANs; VLAN-aware bridges do.
            </p>
          )}
          <p className="mt-2 text-xs text-faint">
            Apply with <span className="font-mono text-muted">ifreload -a</span> (ifupdown2), which is what the GUI&apos;s
            &quot;Apply Configuration&quot; runs; no reboot needed.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function Frame({ tagged, highlight, jumbo }: { tagged: boolean; highlight: boolean; jumbo: boolean }) {
  return (
    <span className={clsx("inline-flex overflow-hidden rounded border font-mono text-[10px]", highlight ? "border-warn animate-flash" : "border-line")}>
      <span className="bg-f1/15 px-1.5 py-0.5 text-f1">dst|src MAC</span>
      {tagged && <span className="bg-warn/20 px-1.5 py-0.5 text-warn">802.1Q 20</span>}
      <span className="bg-panel-2 px-1.5 py-0.5 text-muted">IP… {jumbo ? "≤9000" : "≤1500"}</span>
    </span>
  );
}

function buildInterfaces({ bond, vlanAware, jumbo }: { bond: BondMode; vlanAware: boolean; jumbo: boolean }) {
  const mtu = jumbo ? "\n    mtu 9000" : "";
  const L: string[] = ["auto lo", "iface lo inet loopback", ""];
  const nics = bond === "none" ? ["eno1"] : ["eno1", "eno2"];
  for (const nic of nics) L.push(`auto ${nic}`, `iface ${nic} inet manual${mtu}`, "");
  let port = "eno1";
  if (bond !== "none") {
    port = "bond0";
    L.push("auto bond0", "iface bond0 inet manual", "    bond-slaves eno1 eno2", "    bond-miimon 100", `    bond-mode ${bond}`);
    if (bond === "802.3ad") L.push("    bond-xmit-hash-policy layer3+4");
    if (bond === "active-backup") L.push("    bond-primary eno1");
    if (jumbo) L.push("    mtu 9000");
    L.push("");
  }
  L.push(
    "auto vmbr0",
    "iface vmbr0 inet static",
    "    address 192.168.10.11/24",
    "    gateway 192.168.10.1",
    `    bridge-ports ${port}`,
    "    bridge-stp off",
    "    bridge-fd 0",
  );
  if (vlanAware) L.push("    bridge-vlan-aware yes", "    bridge-vids 2-4094");
  if (jumbo) L.push("    mtu 9000");
  L.push("", "source /etc/network/interfaces.d/*");
  return L.join("\n");
}

function ConfigView({ text }: { text: string }) {
  const [prev, setPrev] = useState(text);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  if (prev !== text) {
    const before = new Set(prev.split("\n"));
    setChanged(new Set(text.split("\n").filter((l) => l.trim() && !before.has(l))));
    setPrev(text);
  }
  return (
    <pre className="max-h-[420px] overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed">
      {text.split("\n").map((l, i) => {
        const kw = /^(auto|iface|source)\b/.test(l);
        return (
          <div
            key={`${i}-${l}`}
            className={clsx(changed.has(l) ? "bg-accent/15 text-accent animate-rise" : kw ? "text-ink" : "text-muted")}
          >
            {l || " "}
          </div>
        );
      })}
    </pre>
  );
}

/* ---------- bond hashing ---------- */

type Flow = { id: number; src: string; dst: string; sport: number; dport: number; color: string };
const FLOWS: Flow[] = [
  { id: 1, src: "192.168.10.50", dst: "192.168.10.20", sport: 51544, dport: 443, color: "var(--color-f1)" },
  { id: 2, src: "192.168.10.50", dst: "192.168.10.20", sport: 51545, dport: 443, color: "var(--color-f2)" },
  { id: 3, src: "192.168.10.51", dst: "192.168.10.21", sport: 40112, dport: 5432, color: "var(--color-f3)" },
  { id: 4, src: "192.168.10.52", dst: "10.20.0.7", sport: 33790, dport: 6379, color: "var(--color-f4)" },
  { id: 5, src: "192.168.10.50", dst: "192.168.10.30", sport: 58001, dport: 80, color: "var(--color-f5)" },
  { id: 6, src: "192.168.10.53", dst: "192.168.10.20", sport: 49200, dport: 443, color: "var(--color-f6)" },
];

const ip2n = (ip: string) => ip.split(".").reduce((a, o) => ((a << 8) | Number(o)) >>> 0, 0);

/** Simplified version of the kernel's bond_xmit_hash() for layer3+4 (IPv4). */
function l34hash(f: Flow) {
  let h = (((f.sport << 16) | f.dport) >>> 0) ^ ip2n(f.src) ^ ip2n(f.dst);
  h = (h ^ (h >>> 16)) >>> 0;
  h = (h ^ (h >>> 8)) >>> 0;
  return h >>> 1;
}

function BondLinks({ mode }: { mode: BondMode }) {
  const [down, setDown] = useState<string | null>(null);
  const links = mode === "none" ? ["eno1"] : ["eno1", "eno2"];
  const up = links.filter((l) => l !== down);

  const assign = (f: Flow, idx: number): string | null => {
    if (up.length === 0) return null;
    if (mode === "none") return up[0];
    if (mode === "active-backup") return up.includes("eno1") ? "eno1" : up[0];
    if (mode === "balance-alb") return up[ip2n(f.dst) % up.length] ?? up[idx % up.length];
    return up[l34hash(f) % up.length];
  };

  const info = BOND_INFO[mode];
  return (
    <Panel
      title="Which link does each flow use?"
      right={
        <div className="flex gap-1">
          {links.map((l) => (
            <Button key={l} variant={down === l ? "danger" : "ghost"} onClick={() => setDown(down === l ? null : l)}>
              {down === l ? `✂ ${l} down` : `cut ${l}`}
            </Button>
          ))}
        </div>
      }
    >
      <div className="space-y-3">
        {links.map((l) => {
          const flows = FLOWS.filter((f, i) => assign(f, i) === l);
          const isDown = l === down;
          return (
            <div key={l} className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3">
              <span className={clsx("font-mono text-xs", isDown ? "text-bad line-through" : "text-ink")}>{l}</span>
              <div className={clsx("relative h-9 overflow-hidden rounded-md border", isDown ? "border-bad/50 bg-bad/5" : "border-line bg-bg")}>
                {!isDown && (
                  <svg className="absolute inset-0 size-full" preserveAspectRatio="none" aria-hidden>
                    <line x1="0" y1="50%" x2="100%" y2="50%" stroke="var(--color-line)" strokeWidth="2" strokeDasharray="6 6" className="animate-dash" />
                  </svg>
                )}
                <div className="relative flex h-full items-center gap-1.5 px-2">
                  {flows.map((f) => (
                    <span key={f.id} className="rounded px-1.5 py-0.5 font-mono text-[10px] text-black transition-all animate-rise" style={{ background: f.color }}>
                      flow {f.id}
                    </span>
                  ))}
                  {isDown && <span className="text-xs text-bad">no carrier</span>}
                  {!isDown && flows.length === 0 && <span className="text-[11px] text-faint">{mode === "active-backup" ? "standby" : "idle"}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer text-faint">flows</summary>
        <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
          {FLOWS.map((f) => (
            <li key={f.id}>
              <span style={{ color: f.color }}>flow {f.id}</span> {f.src}:{f.sport} → {f.dst}:{f.dport}
              {mode === "802.3ad" && <span className="text-faint"> · hash mod 2 = {l34hash(f) % 2}</span>}
            </li>
          ))}
        </ul>
      </details>
      <div className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-muted">
        <Pill color={info.tone === "ok" ? "var(--color-ok)" : info.tone === "warn" ? "var(--color-warn)" : "var(--color-info)"}>switch</Pill>
        <span>{info.switchNeeds}</span>
      </div>
    </Panel>
  );
}

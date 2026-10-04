"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button, Panel, Pill, Segmented, Toggle } from "../ui";

type Proto = "tcp" | "udp" | "icmp";
type Verdict = "ACCEPT" | "DROP";
type Target = "host" | "vm";
type Dir = "in" | "out";
type Backend = "iptables" | "nftables";

type Rule = {
  file: string;
  text: string;
  dir: Dir;
  action: Verdict;
  src?: string; // cidr list or +ipset or alias
  proto?: Proto;
  dport?: [number, number];
  builtin?: boolean;
  check?: (p: Pkt) => boolean;
};

type Pkt = { src: string; proto: Proto; dport: number; dir: Dir; target: Target };

const ALIASES: Record<string, string[]> = { admin_laptop: ["192.168.10.5/32"] };
const IPSETS: Record<string, string[]> = {
  blocklist: ["203.0.113.0/24"],
  management: ["192.168.10.5/32"],
  local_network: ["192.168.10.0/24"],
  "ipfilter-net0": ["192.168.10.50/32"],
};

const ip2n = (ip: string) => ip.split(".").reduce((a, o) => ((a << 8) | Number(o)) >>> 0, 0);
function inCidr(ip: string, cidr: string) {
  const [net, bits] = cidr.split("/");
  const b = Number(bits ?? 32);
  const mask = b === 0 ? 0 : (~0 << (32 - b)) >>> 0;
  return (ip2n(ip) & mask) === (ip2n(net) & mask);
}
function srcMatches(ip: string, spec?: string) {
  if (!spec) return true;
  const list = spec.startsWith("+") ? IPSETS[spec.slice(1)] : (ALIASES[spec] ?? [spec]);
  return list.some((c) => inCidr(ip, c.includes("/") ? c : `${c}/32`));
}
function matches(r: Rule, p: Pkt) {
  if (r.check) return r.check(p);
  if (r.dir !== p.dir) return false;
  if (r.proto && r.proto !== p.proto) return false;
  if (r.dport && (p.proto === "icmp" || p.dport < r.dport[0] || p.dport > r.dport[1])) return false;
  return srcMatches(p.src, r.src);
}

const SOURCES = [
  { ip: "192.168.10.5", label: "admin laptop (LAN)" },
  { ip: "192.168.10.66", label: "other LAN host" },
  { ip: "10.8.0.2", label: "admin via VPN" },
  { ip: "198.51.100.7", label: "internet client" },
  { ip: "203.0.113.9", label: "blocklisted IP" },
];
const VM_SOURCES = [
  { ip: "192.168.10.50", label: "VM's own IP" },
  { ip: "192.168.10.51", label: "spoofed IP" },
];

const PORTS: { proto: Proto; port: number; label: string }[] = [
  { proto: "tcp", port: 8006, label: "8006 GUI" },
  { proto: "tcp", port: 22, label: "22 SSH" },
  { proto: "tcp", port: 443, label: "443 HTTPS" },
  { proto: "tcp", port: 9100, label: "9100 exporter" },
  { proto: "tcp", port: 25, label: "25 SMTP" },
  { proto: "udp", port: 5405, label: "5405 corosync" },
  { proto: "icmp", port: 0, label: "ping" },
];

function buildRules(vpnRule: boolean): { host: Rule[]; vmIn: Rule[]; vmOut: Rule[] } {
  const group: Rule[] = [
    { file: "group webserver", text: "IN DROP -source +blocklist", dir: "in", action: "DROP", src: "+blocklist" },
    { file: "group webserver", text: "IN ACCEPT -p tcp -dport 80", dir: "in", action: "ACCEPT", proto: "tcp", dport: [80, 80] },
    { file: "group webserver", text: "IN ACCEPT -p tcp -dport 443", dir: "in", action: "ACCEPT", proto: "tcp", dport: [443, 443] },
  ];
  const host: Rule[] = [
    { file: "host.fw (pve1)", text: "IN ACCEPT -source +local_network -p tcp -dport 9100", dir: "in", action: "ACCEPT", src: "+local_network", proto: "tcp", dport: [9100, 9100] },
    { file: "cluster.fw", text: "IN DROP -source +blocklist", dir: "in", action: "DROP", src: "+blocklist" },
    ...(vpnRule
      ? [{ file: "cluster.fw", text: "IN ACCEPT -source 10.8.0.0/24 -p tcp -dport 8006", dir: "in" as Dir, action: "ACCEPT" as Verdict, src: "10.8.0.0/24", proto: "tcp" as Proto, dport: [8006, 8006] as [number, number] }]
      : []),
    {
      file: "built-in",
      text: "management + local_network → tcp 8006, 22, 3128, 5900-5999",
      dir: "in",
      action: "ACCEPT",
      builtin: true,
      check: (p) =>
        p.proto === "tcp" &&
        (srcMatches(p.src, "+management") || srcMatches(p.src, "+local_network")) &&
        (p.dport === 8006 || p.dport === 22 || p.dport === 3128 || (p.dport >= 5900 && p.dport <= 5999)),
    },
    {
      file: "built-in",
      text: "cluster network → udp 5405-5412 (corosync)",
      dir: "in",
      action: "ACCEPT",
      builtin: true,
      check: (p) => p.proto === "udp" && p.dport >= 5405 && p.dport <= 5412 && srcMatches(p.src, "+local_network"),
    },
    { file: "built-in", text: "icmp types 3, 4, 11 (errors only, not ping)", dir: "in", action: "ACCEPT", builtin: true, check: () => false },
    { file: "cluster.fw", text: "policy_in: DROP", dir: "in", action: "DROP", builtin: true, check: () => true },
  ];
  const vmIn: Rule[] = [
    ...group.map((r) => ({ ...r, file: "100.fw → GROUP webserver" })),
    { file: "100.fw", text: "IN SSH(ACCEPT) -source admin_laptop", dir: "in", action: "ACCEPT", src: "admin_laptop", proto: "tcp", dport: [22, 22] },
    { file: "100.fw", text: "IN ACCEPT -p icmp", dir: "in", action: "ACCEPT", proto: "icmp" },
    { file: "100.fw", text: "policy_in: DROP", dir: "in", action: "DROP", builtin: true, check: () => true },
  ];
  const vmOut: Rule[] = [
    {
      file: "built-in",
      text: "ipfilter: source ∉ +ipfilter-net0 → DROP",
      dir: "out",
      action: "DROP",
      builtin: true,
      check: (p) => !srcMatches(p.src, "+ipfilter-net0"),
    },
    { file: "built-in", text: "macfilter: source MAC ≠ net0 MAC → DROP", dir: "out", action: "DROP", builtin: true, check: () => false },
    { file: "100.fw", text: "OUT DROP -p tcp -dport 25", dir: "out", action: "DROP", proto: "tcp", dport: [25, 25] },
    { file: "100.fw", text: "policy_out: ACCEPT", dir: "out", action: "ACCEPT", builtin: true, check: () => true },
  ];
  return { host, vmIn, vmOut };
}

export function RuleEvaluator() {
  const [target, setTarget] = useState<Target>("vm");
  const [dir, setDir] = useState<Dir>("in");
  const [src, setSrc] = useState("198.51.100.7");
  const [portIdx, setPortIdx] = useState(2);
  const [backend, setBackend] = useState<Backend>("iptables");
  const [dcEnable, setDcEnable] = useState(true);
  const [nicFw, setNicFw] = useState(true);
  const [vpnRule, setVpnRule] = useState(false);
  const [tick, setTick] = useState(0);
  const [runId, setRunId] = useState(0);

  const effDir: Dir = target === "host" ? "in" : dir;
  const sources = target === "vm" && effDir === "out" ? VM_SOURCES : SOURCES;
  const srcIp = sources.some((s) => s.ip === src) ? src : sources[0].ip;
  const port = PORTS[portIdx];
  const pkt: Pkt = { src: srcIp, proto: port.proto, dport: port.port, dir: effDir, target };

  const rules = useMemo(() => buildRules(vpnRule), [vpnRule]);
  const list = target === "host" ? rules.host : effDir === "in" ? rules.vmIn : rules.vmOut;
  const filtering = dcEnable && (target === "host" || nicFw);
  const matchIdx = filtering ? list.findIndex((r) => matches(r, pkt)) : -1;
  const verdict: Verdict = filtering ? list[matchIdx].action : "ACCEPT";

  // path the packet takes
  const path = useMemo(() => {
    if (target === "host") return ["eno1", "vmbr0", "host INPUT ⟂"];
    const fwHere = filtering;
    let p: string[];
    if (fwHere && backend === "iptables") p = ["eno1", "vmbr0", "fwpr100p0", "fwln100i0", "fwbr100i0 ⟂", "tap100i0", "VM 100"];
    else if (fwHere) p = ["eno1", "vmbr0 ⟂ (nft bridge)", "tap100i0", "VM 100"];
    else p = ["eno1", "vmbr0", "tap100i0", "VM 100"];
    return effDir === "out" ? [...p].reverse() : p;
  }, [target, filtering, backend, effDir]);
  const filterHop = filtering ? path.findIndex((h) => h.includes("⟂")) : -1;

  // timeline: move to filter hop, evaluate rules one per tick, then continue (if accepted)
  const preTicks = filtering ? filterHop : path.length - 1;
  const evalTicks = filtering ? matchIdx + 1 : 0;
  const postTicks = verdict === "ACCEPT" ? path.length - 1 - (filtering ? filterHop : path.length - 1) : 0;
  const total = preTicks + evalTicks + postTicks;

  const key = `${target}|${effDir}|${srcIp}|${portIdx}|${backend}|${dcEnable}|${nicFw}|${vpnRule}|${runId}`;
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setTick(0);
  }
  useEffect(() => {
    if (tick >= total) return;
    const t = setTimeout(() => setTick((x) => x + 1), 420);
    return () => clearTimeout(t);
  }, [tick, total, key]);

  const hopPos = tick <= preTicks ? tick : tick < preTicks + evalTicks ? preTicks : Math.min(preTicks + (tick - preTicks - evalTicks), path.length - 1);
  const evaluating = filtering && tick > preTicks ? Math.min(tick - preTicks - 1, matchIdx) : -1;
  const done = tick >= total;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Panel title="Build a packet">
        <div className="space-y-4">
          <Row label="destination">
            <Segmented<Target>
              value={target}
              onChange={setTarget}
              options={[
                { value: "host", label: "node pve1 (192.168.10.11)" },
                { value: "vm", label: "VM 100 web (192.168.10.50)" },
              ]}
            />
          </Row>
          {target === "vm" && (
            <Row label="direction">
              <Segmented<Dir>
                value={dir}
                onChange={setDir}
                options={[
                  { value: "in", label: "IN (to the VM)" },
                  { value: "out", label: "OUT (from the VM)" },
                ]}
              />
            </Row>
          )}
          <Row label={effDir === "out" ? "source (VM)" : "source"}>
            <div className="flex flex-wrap gap-1.5">
              {sources.map((s) => (
                <button
                  key={s.ip}
                  type="button"
                  onClick={() => setSrc(s.ip)}
                  className={clsx(
                    "rounded-md border px-2 py-1 text-left transition",
                    s.ip === srcIp ? "border-accent bg-accent/10" : "border-line bg-panel-2 hover:border-faint",
                  )}
                >
                  <div className="font-mono text-[11px] text-ink">{s.ip}</div>
                  <div className="text-[10px] text-faint">{s.label}</div>
                </button>
              ))}
            </div>
          </Row>
          <Row label="proto / port">
            <div className="flex flex-wrap gap-1.5">
              {PORTS.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPortIdx(i)}
                  className={clsx(
                    "rounded-md border px-2 py-1 font-mono text-[11px] transition",
                    i === portIdx ? "border-accent bg-accent/10 text-ink" : "border-line bg-panel-2 text-muted hover:border-faint",
                  )}
                >
                  {p.proto} {p.label}
                </button>
              ))}
            </div>
          </Row>
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3">
            <Toggle checked={dcEnable} onChange={setDcEnable} label="datacenter firewall enabled" />
            {target === "vm" && <Toggle checked={nicFw} onChange={setNicFw} label="net0 firewall=1" />}
            {target === "host" && <Toggle checked={vpnRule} onChange={setVpnRule} label="rule: allow VPN 10.8.0.0/24 → 8006" />}
          </div>
          {target === "vm" && (
            <Row label="backend">
              <Segmented<Backend>
                value={backend}
                onChange={setBackend}
                options={[
                  { value: "iptables", label: "pve-firewall (iptables)" },
                  { value: "nftables", label: "proxmox-firewall (nftables)" },
                ]}
              />
            </Row>
          )}
        </div>

        {/* path */}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] tracking-wide text-faint uppercase">path</span>
            <Button variant="ghost" onClick={() => setRunId((r) => r + 1)}>
              ↻ resend
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1" aria-live="polite">
            {path.map((h, i) => {
              const here = i === hopPos;
              const isFilter = h.includes("⟂");
              const blocked = done && verdict === "DROP" && i > hopPos;
              return (
                <div key={`${h}-${i}`} className="flex items-center gap-1">
                  <span
                    className={clsx(
                      "rounded-md border px-1.5 py-1 font-mono text-[10.5px] transition",
                      here && done && verdict === "DROP" ? "border-bad bg-bad/15 text-bad" : here ? "border-warn bg-warn/15 text-ink" : isFilter ? "border-f5/50 text-f5" : "border-line text-muted",
                      blocked && "opacity-30",
                    )}
                  >
                    {here && <span className="mr-1 inline-block size-2 rounded-full bg-warn align-middle animate-pulse-soft" />}
                    {h}
                  </span>
                  {i < path.length - 1 && <span className={clsx("text-faint", blocked && "opacity-30")}>→</span>}
                </div>
              );
            })}
          </div>
          {target === "vm" && filtering && (
            <p className="mt-2 text-xs text-faint">
              {backend === "iptables"
                ? "iptables can only filter bridged traffic through br_netfilter, so every firewalled NIC gets its own fwbr bridge and veth pair."
                : "The nftables backend filters bridged traffic directly, so Linux-bridge guests need no fwbr/fwln/fwpr devices (OVS bridges still get them)."}
            </p>
          )}
        </div>
      </Panel>

      <Panel
        title="Rules, evaluated top to bottom"
        right={
          done ? (
            <Pill color={verdict === "ACCEPT" ? "var(--color-ok)" : "var(--color-bad)"} className="animate-flash">
              {verdict}
            </Pill>
          ) : (
            <span className="font-mono text-[11px] text-faint">evaluating…</span>
          )
        }
      >
        {!filtering ? (
          <p className="py-6 text-center text-sm text-muted">
            {!dcEnable
              ? "With enable: 0 in cluster.fw no rules are loaded at all, on any node or guest. Everything is accepted."
              : "net0 has firewall=0: this NIC is never filtered, whatever 100.fw says."}
          </p>
        ) : (
          <ol className="space-y-1">
            <li className="rounded-md px-2 py-1 font-mono text-[11px] text-faint">ct state established,related → ACCEPT · (new connection, skip)</li>
            {list.map((r, i) => {
              const state = i < evaluating || (i === evaluating && i !== matchIdx) ? "miss" : i === evaluating && i === matchIdx ? "hit" : "idle";
              return (
                <li
                  key={`${r.file}-${r.text}`}
                  className={clsx(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5 transition",
                    state === "hit" && r.action === "ACCEPT" && "border-ok/60 bg-ok/10",
                    state === "hit" && r.action === "DROP" && "border-bad/60 bg-bad/10",
                    state === "miss" && "border-transparent opacity-45",
                    state === "idle" && "border-line/60",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[10px] text-faint">{r.file}</div>
                    <div className={clsx("font-mono text-[12px]", r.builtin ? "text-muted italic" : "text-ink")}>{r.text}</div>
                  </div>
                  <span className={clsx("font-mono text-[10px]", state === "hit" ? (r.action === "ACCEPT" ? "text-ok" : "text-bad") : "text-faint")}>
                    {state === "hit" ? `match → ${r.action}` : state === "miss" ? "no match" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {done && <Explain pkt={pkt} verdict={verdict} rule={filtering ? list[matchIdx] : undefined} />}
      </Panel>
    </div>
  );
}

function Explain({ pkt, verdict, rule }: { pkt: Pkt; verdict: Verdict; rule?: Rule }) {
  let msg = "";
  if (!rule) msg = "Nothing filters this packet.";
  else if (pkt.target === "host" && pkt.src === "10.8.0.2" && pkt.dport === 8006 && verdict === "DROP")
    msg = "Locked out: the built-in rule only trusts management and local_network. An admin arriving from another subnet hits policy_in DROP. Add an explicit rule (toggle it on) before enabling the firewall.";
  else if (rule.text.startsWith("ipfilter")) msg = "Anti-spoofing: with ipfilter: 1 the VM may only send from the addresses in ipfilter-net0 (for containers, their configured IPs are added automatically).";
  else if (rule.text.startsWith("policy")) msg = `No rule matched, so the chain's default policy decides: ${verdict}.`;
  else if (rule.file.includes("GROUP")) msg = "The security group is defined once in cluster.fw and inserted where 100.fw says GROUP webserver, at that position in the order.";
  else if (rule.builtin) msg = "One of the rules Proxmox adds itself so a cluster keeps working when the policy is DROP.";
  else msg = "First match wins: rules below this one are never evaluated.";
  return <p className="mt-3 text-[13px] leading-relaxed text-muted animate-rise">{msg}</p>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-start">
      <span className="pt-1 text-[11px] tracking-wide text-faint uppercase">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Panel } from "../ui";

type NodeId = "browser" | "pveproxy" | "pvedaemon" | "qemu" | "pmxcfs" | "storage" | "kvm" | "vmbr0" | "pvestatd";

const NODES: Record<NodeId, { x: number; y: number; label: string; sub: string; color: string }> = {
  browser: { x: 70, y: 70, label: "browser", sub: "Start ▶", color: "#e7e9f0" },
  pveproxy: { x: 230, y: 70, label: "pveproxy", sub: ":8006 www-data", color: "#e57000" },
  pvedaemon: { x: 390, y: 70, label: "pvedaemon", sub: "127.0.0.1:85 root", color: "#e57000" },
  qemu: { x: 550, y: 70, label: "qemu-server", sub: "vm_start()", color: "#e57000" },
  kvm: { x: 710, y: 70, label: "kvm -id 100", sub: "100.scope", color: "#38bdf8" },
  vmbr0: { x: 870, y: 70, label: "vmbr0", sub: "tap100i0", color: "#22d3ee" },
  pmxcfs: { x: 470, y: 220, label: "pmxcfs", sub: "/etc/pve", color: "#fbbf24" },
  storage: { x: 630, y: 220, label: "pve-storage", sub: "local-lvm", color: "#a78bfa" },
  pvestatd: { x: 790, y: 220, label: "pvestatd", sub: "QMP poll", color: "#34d399" },
};

type Step = { from: NodeId; to: NodeId; title: string; detail: string; log: string };

const STEPS: Step[] = [
  {
    from: "browser",
    to: "pveproxy",
    title: "HTTPS request to port 8006",
    detail: "The UI calls the API like any client would. The session ticket travels as a cookie; because this is a write (POST), the CSRFPreventionToken header is required too.",
    log: "POST /api2/json/nodes/pve1/qemu/100/status/start\nCookie: PVEAuthCookie=PVE:alice@pve:6720B1C4::…\nCSRFPreventionToken: 6720B1C4:Y2…",
  },
  {
    from: "pveproxy",
    to: "pvedaemon",
    title: "Unprivileged proxy forwards to the root daemon",
    detail: "pveproxy (www-data) validates the ticket signature. The start method is marked protected (it needs root), so it's forwarded to pvedaemon on 127.0.0.1:85. Had the VM lived on pve2, the request would be proxied to pve2's pveproxy instead.",
    log: "pveproxy: proxy → 127.0.0.1:85  (protected call)",
  },
  {
    from: "pvedaemon",
    to: "browser",
    title: "Permission check, fork a task, answer at once",
    detail: "pvedaemon checks VM.PowerMgmt on /vms/100 against the ACLs in user.cfg, forks a worker and immediately returns its UPID. The UI then polls the task status: starting a VM is asynchronous.",
    log: '{"data":"UPID:pve1:0003A1F2:01B4C7D9:6720B1C9:qmstart:100:alice@pve:"}',
  },
  {
    from: "pvedaemon",
    to: "qemu",
    title: "Worker runs qemu-server's vm_start",
    detail: "The same code path as running `qm start 100` on the shell. It takes the local lock /var/lock/qemu-server/lock-100.conf so no other operation (backup, migrate) touches VM 100 at the same time.",
    log: "task started: qmstart:100  (= qm start 100)",
  },
  {
    from: "qemu",
    to: "pmxcfs",
    title: "Read the config from the cluster file system",
    detail: "The config lives in /etc/pve/nodes/pve1/qemu-server/100.conf, which /etc/pve/qemu-server/100.conf links to. Because it's in pve1's directory, pve1 owns the VM; no other node will start it.",
    log: "read /etc/pve/qemu-server/100.conf\n  scsi0: local-lvm:vm-100-disk-0,iothread=1\n  net0: virtio=BC:24:11:5E:20:01,bridge=vmbr0",
  },
  {
    from: "qemu",
    to: "storage",
    title: "Activate the disk volumes",
    detail: "The storage plugin turns each volume ID into a block device or file path. For LVM-thin this activates the logical volume; for Ceph it maps the RBD image; for ZFS it's the zvol path.",
    log: "lvchange -ay pve/vm-100-disk-0\n→ /dev/pve/vm-100-disk-0",
  },
  {
    from: "qemu",
    to: "kvm",
    title: "Spawn the QEMU/KVM process",
    detail: "qemu-server builds a long command line (see `qm showcmd 100`) and runs it in its own systemd scope, so the VM's CPU and memory are accounted in a cgroup. QEMU opens /dev/kvm; each vCPU becomes a thread.",
    log: "systemd-run --scope --slice qemu --unit 100 \\\n  /usr/bin/kvm -id 100 -name web01 -machine type=q35 \\\n  -chardev socket,id=qmp,path=/var/run/qemu-server/100.qmp,server=on,wait=off \\\n  -netdev type=tap,id=net0,ifname=tap100i0,script=…/pve-bridge …",
  },
  {
    from: "kvm",
    to: "vmbr0",
    title: "Plug the NIC into the bridge",
    detail: "QEMU creates tap100i0 and runs the pve-bridge hook, which attaches it to vmbr0 (applying the VLAN tag and MTU). With the guest firewall enabled on the iptables firewall, an extra fwbr100i0 bridge is inserted in between.",
    log: "tap100i0 → master vmbr0  state UP",
  },
  {
    from: "kvm",
    to: "qemu",
    title: "Talk to QEMU over QMP",
    detail: "From now on qemu-server controls the running VM through its QMP socket (JSON over a UNIX socket): status, shutdown, hot-plug, snapshots, live migration. qmeventd listens for the shutdown event to clean up.",
    log: '→ {"execute":"query-status"}\n← {"return":{"status":"running","running":true}}',
  },
  {
    from: "pvestatd",
    to: "pmxcfs",
    title: "Status flows back to every node",
    detail: "pvestatd polls the running VM and broadcasts its status through pmxcfs, so the icon turns green on all nodes' UIs. The task log ends with TASK OK.",
    log: "TASK OK\nvm 100 status: running  (cpu 2%, mem 1.1 GiB)",
  },
];

export function StartTrace() {
  const [i, setI] = useState(-1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setI((v) => {
        if (v >= STEPS.length - 1) {
          setPlaying(false);
          return v;
        }
        return v + 1;
      });
    }, 2600);
    return () => clearInterval(t);
  }, [playing]);

  const step = i >= 0 ? STEPS[i] : null;
  const visited = new Set<NodeId>();
  STEPS.slice(0, i + 1).forEach((s) => {
    visited.add(s.from);
    visited.add(s.to);
  });
  const p = step ? NODES[step.to] : NODES.browser;
  const vmRunning = i >= 6;

  return (
    <Panel
      title='Trace: what happens when you click "Start" on VM 100'
      right={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              if (i >= STEPS.length - 1) setI(0);
              else if (i < 0) setI(0);
              setPlaying((x) => !x);
            }}
          >
            {playing ? "Pause" : i >= STEPS.length - 1 ? "Replay" : "Play"}
          </Button>
          <Button onClick={() => { setPlaying(false); setI((v) => Math.max(-1, v - 1)); }} disabled={i < 0}>
            ← Back
          </Button>
          <Button onClick={() => { setPlaying(false); setI((v) => Math.min(STEPS.length - 1, v + 1)); }} disabled={i >= STEPS.length - 1}>
            Step →
          </Button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <svg viewBox="0 0 940 280" className="min-w-[720px]" role="img" aria-label="Request path from browser through pveproxy, pvedaemon, qemu-server, pmxcfs, storage, kvm and the bridge">
          <defs>
            <marker id="st-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#5a6275" />
            </marker>
          </defs>
          {/* host boundary */}
          <rect x={150} y={18} width={782} height={250} rx={14} fill="none" stroke="#242a38" strokeDasharray="4 6" />
          <text x={162} y={36} fill="#5a6275" fontSize={11} fontFamily="var(--font-mono)">
            node pve1
          </text>

          {/* static edges */}
          {STEPS.map((s, k) => {
            const a = NODES[s.from];
            const b = NODES[s.to];
            const active = k === i;
            const done = k < i;
            const curved = s.from === "pvedaemon" && s.to === "browser";
            const back = s.from === "kvm" && s.to === "qemu";
            const d = curved
              ? `M ${a.x} ${a.y - 26} C ${a.x - 60} ${a.y - 70}, ${b.x + 60} ${b.y - 70}, ${b.x + 10} ${b.y - 26}`
              : back
                ? `M ${a.x - 10} ${a.y + 26} C ${a.x - 40} ${a.y + 60}, ${b.x + 40} ${b.y + 60}, ${b.x + 10} ${b.y + 26}`
                : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
            return (
              <path
                key={k}
                d={d}
                fill="none"
                stroke={active ? NODES[s.to].color : done ? "#3a4255" : "#1d2230"}
                strokeWidth={active ? 2 : 1.3}
                strokeDasharray={active ? "6 6" : undefined}
                className={active ? "animate-dash" : undefined}
              />
            );
          })}

          {(Object.keys(NODES) as NodeId[]).map((id) => {
            const n = NODES[id];
            const hot = step && (step.from === id || step.to === id);
            const seen = visited.has(id);
            return (
              <g key={id} style={{ transition: "opacity 300ms" }} opacity={seen || i < 0 ? 1 : 0.45}>
                <rect
                  x={n.x - 64}
                  y={n.y - 26}
                  width={128}
                  height={52}
                  rx={10}
                  fill={hot ? `${n.color}1f` : "#171b24"}
                  stroke={hot ? n.color : "#242a38"}
                  strokeWidth={hot ? 1.6 : 1}
                />
                <text x={n.x} y={n.y - 3} textAnchor="middle" fill="#e7e9f0" fontSize={13} fontWeight={600} fontFamily="var(--font-mono)">
                  {n.label}
                </text>
                <text x={n.x} y={n.y + 14} textAnchor="middle" fill="#8a93a8" fontSize={10.5}>
                  {n.sub}
                </text>
                {id === "kvm" && (
                  <circle cx={n.x + 52} cy={n.y - 14} r={4} fill={vmRunning ? "#34d399" : "#5a6275"} className={vmRunning ? "animate-pulse-soft" : undefined} />
                )}
              </g>
            );
          })}

          {/* packet */}
          <circle
            cx={p.x}
            cy={p.y - 30}
            r={6}
            fill={step ? NODES[step.to].color : "#5a6275"}
            style={{ transition: "cx 700ms ease-in-out, cy 700ms ease-in-out" }}
            stroke="#0a0c11"
            strokeWidth={2}
          />
        </svg>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-h-[132px]">
          {step ? (
            <div key={i} className="animate-rise">
              <div className="font-mono text-xs text-accent">
                step {i + 1}/{STEPS.length} · {NODES[step.from].label} → {NODES[step.to].label}
              </div>
              <div className="mt-1 font-medium">{step.title}</div>
              <p className="mt-1 text-sm leading-relaxed text-muted">{step.detail}</p>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              Press <span className="text-ink">Play</span> or <span className="text-ink">Step</span> to follow one click through every layer of the
              stack. Nothing here is UI-specific: <code className="font-mono text-ink">qm start 100</code> joins at step 4.
            </p>
          )}
        </div>
        <pre className="min-h-[132px] overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11.5px] leading-relaxed text-muted">
          {step ? step.log : "# waiting…"}
        </pre>
      </div>

      <ol className="mt-3 flex flex-wrap gap-1" aria-label="Steps">
        {STEPS.map((s, k) => (
          <li key={k}>
            <button
              type="button"
              onClick={() => { setPlaying(false); setI(k); }}
              className={clsx(
                "h-1.5 w-8 rounded-full transition",
                k === i ? "bg-accent" : k < i ? "bg-faint" : "bg-line hover:bg-faint",
              )}
              aria-label={`Step ${k + 1}: ${s.title}`}
            />
          </li>
        ))}
      </ol>
    </Panel>
  );
}

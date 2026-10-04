"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Button, Panel, Segmented, Toggle } from "../ui";

type Tab = "cmd" | "user" | "network" | "meta";

// Tiny deterministic hash, standing in for the SHA1 Proxmox puts in instance-id.
function digest(s: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x1234567;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 2654435761) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + (h1 ^ h2).toString(16).padStart(8, "0")).slice(0, 40);
}

const BOOT = [
  { t: "firmware + kernel", log: "[    0.000000] Linux version 6.12.48+deb13-cloud-amd64 …", d: "The cloud image boots like any VM. Nothing is configured yet: no user, no IP, a generic hostname." },
  { t: "cloud-init local: find datasource", log: "cloud-init[412]: ds-identify: found NoCloud (label cidata on /dev/sr0)", d: "ds-identify scans for a known datasource. The Proxmox cloud-init drive (ide2) is an ISO labelled cidata: the NoCloud format." },
  { t: "check instance-id", log: "cloud-init[412]: new instance-id 3f1c…: running per-instance modules", d: "If instance-id differs from the last boot, this is a 'new instance' and per-instance modules run again (users, SSH host keys…)." },
  { t: "apply network-config", log: "cloud-init[412]: Applying network configuration from ds", d: "network-config (v1) is rendered for the guest's network stack: netplan, systemd-networkd or ifupdown." },
  { t: "init: hostname, users, keys", log: "cloud-init[530]: Generating public/private ed25519 key pair.\ncloud-init[530]: Adding user ops, authorized_keys: 1", d: "Sets the hostname, creates the default user with your SSH key, regenerates SSH host keys so clones don't share them." },
  { t: "config + final", log: "cloud-init[701]: Upgrading packages …\nCloud-init v. 25.1 finished at … Datasource DataSourceNoCloud [seed=/dev/sr0]", d: "package_upgrade, runcmd and the rest. Then the VM is ready; with the guest agent installed the UI shows its IP." },
  { t: "ssh in", log: "$ ssh ops@{IP}\nops@web01:~$", d: "First login, no console needed. Every clone of the same template gets its own identity this way." },
];

export function CloudInitLab() {
  const [user, setUser] = useState("ops");
  const [hostname, setHostname] = useState("web01");
  const [net, setNet] = useState<"dhcp" | "static">("static");
  const [ip, setIp] = useState("10.0.10.21/24");
  const [gw, setGw] = useState("10.0.10.1");
  const [upgrade, setUpgrade] = useState(true);
  const [custom, setCustom] = useState(false);
  const [tab, setTab] = useState<Tab>("cmd");
  const [step, setStep] = useState(-1);

  useEffect(() => {
    if (step < 0 || step >= BOOT.length - 1) return;
    const t = setTimeout(() => setStep((s) => s + 1), 1500);
    return () => clearTimeout(t);
  }, [step]);

  const [addr, prefix] = ip.split("/");
  const mask = useMemo(() => {
    const p = Math.max(0, Math.min(32, Number(prefix) || 24));
    const m = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
    return [24, 16, 8, 0].map((s) => (m >>> s) & 255).join(".");
  }, [prefix]);

  const ipconfig = net === "dhcp" ? "ip=dhcp" : `ip=${ip},gw=${gw}`;
  const cmd = [
    `qm set 9000 --ide2 local-lvm:cloudinit`,
    `qm clone 9000 201 --name ${hostname}`,
    `qm set 201 --ciuser ${user} --sshkeys ~/.ssh/id_ed25519.pub \\`,
    `  --ipconfig0 ${ipconfig} --nameserver 1.1.1.1 --searchdomain lab.example \\`,
    `  --ciupgrade ${upgrade ? 1 : 0}${custom ? " \\\n  --cicustom \"user=local:snippets/web.yaml\"" : ""}`,
    `qm cloudinit dump 201 user     # inspect what the guest will get`,
    `qm start 201`,
  ].join("\n");

  const userData = custom
    ? `# from /var/lib/vz/snippets/web.yaml (cicustom replaces the generated user-data)
#cloud-config
hostname: ${hostname}
users:
  - name: ${user}
    groups: [sudo]
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI… you@laptop
packages: [nginx, qemu-guest-agent]
runcmd:
  - systemctl enable --now qemu-guest-agent nginx`
    : `#cloud-config
hostname: ${hostname}
manage_etc_hosts: true
fqdn: ${hostname}.lab.example
user: ${user}
ssh_authorized_keys:
  - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI… you@laptop
chpasswd:
  expire: False
users:
  - default
package_upgrade: ${upgrade ? "true" : "false"}`;

  const networkData =
    net === "dhcp"
      ? `version: 1
config:
    - type: physical
      name: eth0
      mac_address: 'bc:24:11:5e:20:c9'
      subnets:
      - type: dhcp4
    - type: nameserver
      address:
      - '1.1.1.1'
      search:
      - 'lab.example'`
      : `version: 1
config:
    - type: physical
      name: eth0
      mac_address: 'bc:24:11:5e:20:c9'
      subnets:
      - type: static
        address: '${addr}'
        netmask: '${mask}'
        gateway: '${gw}'
    - type: nameserver
      address:
      - '1.1.1.1'
      search:
      - 'lab.example'`;

  const iid = digest(userData + networkData);
  const meta = `instance-id: ${iid}`;
  const shownIp = net === "dhcp" ? "10.0.10.137" : addr;

  const files: Record<Tab, string> = { cmd, user: userData, network: networkData, meta };

  const input = "w-full rounded-md border border-line bg-bg px-2 py-1 font-mono text-[12.5px] text-ink";

  return (
    <Panel title="Cloud-init: configure, then watch the first boot">
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[11px] text-faint">name (→ hostname)</span>
            <input className={input} value={hostname} onChange={(e) => setHostname(e.target.value.replace(/[^a-z0-9-]/gi, "").slice(0, 30) || "vm")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[11px] text-faint">ciuser</span>
            <input className={input} value={user} onChange={(e) => setUser(e.target.value.replace(/[^a-z0-9_-]/gi, "").slice(0, 20) || "user")} />
          </label>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] text-faint">ipconfig0</span>
            <Segmented value={net} onChange={setNet} options={["dhcp", "static"]} />
          </div>
          {net === "static" && (
            <div className="grid grid-cols-2 gap-2">
              <input className={input} aria-label="IP with prefix" value={ip} onChange={(e) => setIp(e.target.value)} />
              <input className={input} aria-label="Gateway" value={gw} onChange={(e) => setGw(e.target.value)} />
            </div>
          )}
          <Toggle checked={upgrade} onChange={setUpgrade} label={<span className="font-mono text-[12px]">ciupgrade</span>} />
          <Toggle checked={custom} onChange={setCustom} label={<span className="font-mono text-[12px]">cicustom user=snippets/…</span>} />
          <div className="rounded-lg border border-line bg-bg/60 p-2.5 font-mono text-[11px] leading-relaxed text-muted">
            instance-id
            <div className="break-all text-warn">{iid}</div>
            <div className="mt-1 font-sans text-[11.5px] text-faint">Change any field and it changes: the guest will treat its next boot as a new instance.</div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "cmd", label: "qm commands" },
                { value: "user", label: "user-data" },
                { value: "network", label: "network-config" },
                { value: "meta", label: "meta-data" },
              ]}
            />
            <span className="font-mono text-[10.5px] text-faint">ISO label: cidata · /dev/sr0 in the guest</span>
          </div>
          <pre className="h-[300px] overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed text-muted">{files[tab]}</pre>
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => setStep(0)}>
            {step < 0 ? "qm start 201" : step >= BOOT.length - 1 ? "Replay first boot" : "Booting…"}
          </Button>
          <span className="text-xs text-faint">first boot of a clone, compressed</span>
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <ol className="space-y-1.5">
            {BOOT.map((b, i) => (
              <li
                key={b.t}
                className={clsx(
                  "flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition",
                  i === step ? "border-accent bg-accent/10 text-ink" : i < step ? "border-line text-muted" : "border-transparent text-faint",
                )}
              >
                <span className="mt-0.5 font-mono text-[11px]">{i < step ? "✓" : i === step ? "▸" : String(i + 1).padStart(2, "0")}</span>
                <span>
                  {b.t}
                  {i === step && <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{b.d}</span>}
                </span>
              </li>
            ))}
          </ol>
          <pre className="min-h-[220px] overflow-x-auto rounded-lg border border-line bg-black/40 p-3 font-mono text-[11.5px] leading-relaxed text-ok/90">
            {step < 0
              ? "# serial console (qm terminal 201)"
              : BOOT.slice(0, step + 1)
                  .map((b) => b.log.split("{IP}").join(shownIp).split("web01").join(hostname).split("user ops").join(`user ${user}`).split("ops@").join(`${user}@`))
                  .join("\n")}
          </pre>
        </div>
      </div>
    </Panel>
  );
}

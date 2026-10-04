"use client";

import { useState } from "react";
import clsx from "clsx";
import { Mono, Panel, Pill } from "../ui";

type Block = {
  id: string;
  label: string;
  sub: string;
  color: string;
  title: string;
  what: string;
  why: string;
  files: string[];
  procs: string[];
  try: string;
};

const HW: Block = {
  id: "hw",
  label: "Hardware",
  sub: "CPU · RAM · NICs · disks",
  color: "#5a6275",
  title: "Bare metal",
  what: "x86-64 CPUs with hardware virtualization (Intel VT-x / AMD-V) are mandatory for KVM. IOMMU (VT-d / AMD-Vi) is optional and only needed for PCI(e) passthrough. ECC RAM is strongly recommended when you run ZFS or Ceph.",
  why: "KVM does not emulate the CPU: guest instructions run natively on the physical cores, and the CPU traps privileged operations back to the hypervisor. No VT-x/AMD-V, no KVM, which is why nested labs need the outer hypervisor to expose those flags.",
  files: ["/proc/cpuinfo  (vmx | svm flags)", "/sys/kernel/iommu_groups/"],
  procs: [],
  try: "grep -cE 'vmx|svm' /proc/cpuinfo\ndmesg | grep -i -e DMAR -e IOMMU",
};

const KERNEL: Block = {
  id: "kernel",
  label: "Debian 13 “trixie” + Proxmox kernel",
  sub: "proxmox-kernel-6.x (Ubuntu-derived, ZFS built in)",
  color: "#38bdf8",
  title: "Debian userland, Proxmox kernel",
  what: "Proxmox VE 9 is plain Debian 13 plus Proxmox's own APT repositories. The one big difference is the kernel: proxmox-kernel is based on Ubuntu's kernel sources, with ZFS compiled in and Proxmox's own patches for KVM, LXC and newer hardware. PVE 9.0 shipped 6.14, 9.1 moved the default to 6.17 and 9.2 to 7.0.",
  why: "Debian's stock kernel can't ship ZFS (licensing) and moves slowly on new hardware. Using a single tested kernel for KVM, LXC, ZFS and Ceph is what lets Proxmox treat all of them as one product. Everything else is normal Debian: apt, systemd, journald.",
  files: [
    "/etc/apt/sources.list.d/proxmox.sources  (deb822 format in PVE 9)",
    "/etc/kernel/proxmox-boot-uuids",
    "/boot/vmlinuz-6.*-pve",
  ],
  procs: ["systemd (PID 1)", "journald", "chronyd"],
  try: "uname -r          # e.g. 7.0.x-y-pve on PVE 9.2\npveversion -v\nproxmox-boot-tool kernel list",
};

const ENGINES: Block[] = [
  {
    id: "kvm",
    label: "KVM + QEMU",
    sub: "/dev/kvm · one kvm process per VM",
    color: "#e57000",
    title: "KVM (kernel) + QEMU (userspace)",
    what: "kvm.ko with kvm_intel or kvm_amd exposes /dev/kvm. Each VM is one ordinary Linux process (/usr/bin/kvm from pve-qemu-kvm), each vCPU a thread in it. QEMU provides the virtual hardware: q35 chipset, OVMF or SeaBIOS firmware, VirtIO disks and NICs. qemu-server (the qm tool and its Perl library) turns a config file into that QEMU command line.",
    why: "Because a VM is just a process, normal Linux tools work on it: top shows it, cgroups limit it, kill stops it. And because the config is a small text file in /etc/pve, any node in the cluster can start the same VM.",
    files: [
      "/etc/pve/qemu-server/<vmid>.conf",
      "/var/run/qemu-server/<vmid>.pid",
      "/var/run/qemu-server/<vmid>.qmp  (QMP control socket)",
      "/var/run/qemu-server/<vmid>.vnc",
    ],
    procs: ["kvm -id 100 … (in qemu.slice/100.scope)", "qmeventd"],
    try: "qm list\nqm showcmd 100 --pretty\nsystemctl status 100.scope",
  },
  {
    id: "lxc",
    label: "LXC",
    sub: "namespaces + cgroups v2 · shared kernel",
    color: "#34d399",
    title: "LXC system containers",
    what: "pve-container (the pct tool) generates an LXC config and runs lxc-start. A container is a process tree on the host kernel, isolated with namespaces (pid, net, mount, uts, ipc, user, cgroup), limited with cgroup v2, and confined by AppArmor + seccomp. Unprivileged containers map root to UID 100000 on the host.",
    why: "There is no guest kernel and no virtual hardware, so a container boots in about a second and costs a few MB of RAM. The price: it must be Linux, it shares the host kernel's version and modules, and it can't live-migrate.",
    files: [
      "/etc/pve/lxc/<vmid>.conf",
      "/var/lib/lxc/<vmid>/config  (generated)",
      "/var/lib/lxc/<vmid>/rootfs",
      "/etc/subuid, /etc/subgid",
    ],
    procs: ["lxc-start -F -n 101  (pve-container@101.service)", "/sbin/init inside the CT"],
    try: "pct list\npct config 101\npct enter 101",
  },
  {
    id: "storage",
    label: "Storage plugins",
    sub: "dir · lvmthin · zfspool · rbd · nfs · pbs",
    color: "#a78bfa",
    title: "pve-storage plugins",
    what: "libpve-storage-perl gives every backend the same interface: allocate, free, snapshot, clone, activate, path. Disks are addressed by volume IDs like local-lvm:vm-100-disk-0, which the plugin resolves to /dev/pve/vm-100-disk-0, a zvol, an RBD image or a qcow2 file.",
    why: "VM configs never contain raw device paths, only storage:volume IDs. That indirection is what lets the same config start on another node (shared storage) or be cloned, snapshotted and backed up the same way no matter where the bytes live.",
    files: ["/etc/pve/storage.cfg", "/var/lib/vz/{images,template,dump}  (local dir storage)"],
    procs: ["(library, runs inside pvedaemon / qm / pct)"],
    try: "pvesm status\npvesm list local-lvm\npvesm path local-lvm:vm-100-disk-0",
  },
  {
    id: "net",
    label: "Networking",
    sub: "ifupdown2 · Linux bridges · SDN",
    color: "#22d3ee",
    title: "Linux bridges, bonds, VLANs",
    what: "ifupdown2 applies /etc/network/interfaces. The installer creates vmbr0, a Linux bridge with your physical NIC as its port and the host IP on it. Each VM NIC becomes a tap device (tap100i0), each CT NIC a veth (veth101i0), plugged into a bridge. SDN generates extra bridges/VXLAN/EVPN config from /etc/pve/sdn.",
    why: "A bridge is a software switch inside the kernel, so guests sit on the same L2 network as the host. ifreload -a applies changes without a reboot, and the GUI writes an interfaces.new file you review before applying.",
    files: ["/etc/network/interfaces", "/etc/network/interfaces.d/sdn", "/etc/pve/sdn/*.cfg", "/etc/pve/firewall/*.fw"],
    procs: ["pve-firewall (iptables) or proxmox-firewall (nftables)"],
    try: "ip -br link\nbridge link show\nifreload -a",
  },
];

const PMXCFS: Block = {
  id: "pmxcfs",
  label: "pmxcfs  →  /etc/pve",
  sub: "FUSE · SQLite-backed · replicated via corosync",
  color: "#fbbf24",
  title: "Proxmox Cluster File System",
  what: "/etc/pve is not a normal directory: it's a FUSE file system served by pmxcfs. All content is held in RAM, persisted to the SQLite database /var/lib/pve-cluster/config.db, and every write is replicated to all cluster nodes through corosync's ordered group messaging, so each node applies writes in the same order. It is meant for small config files (tens of MB in total), not data.",
  why: "This is the cluster's single source of truth. A VM belongs to the node whose directory holds its config (nodes/pve1/qemu-server/100.conf), and migrating is literally renaming that file into another node's folder. If a node loses quorum, /etc/pve turns read-only, which stops two halves of a split cluster from both changing the same guest.",
  files: [
    "/etc/pve/nodes/<node>/qemu-server/<vmid>.conf",
    "/etc/pve/qemu-server → nodes/<this node>/qemu-server (symlink)",
    "/etc/pve/storage.cfg, datacenter.cfg, user.cfg, jobs.cfg",
    "/etc/pve/corosync.conf, ha/resources.cfg",
    "/etc/pve/priv/  (authkey, token.cfg, shadow.cfg; root only)",
    "/var/lib/pve-cluster/config.db  (the SQLite backing store)",
  ],
  procs: ["pmxcfs (pve-cluster.service)", "corosync"],
  try: "mount | grep /etc/pve\nls -l /etc/pve/qemu-server\npvecm status",
};

const SERVICES: Block[] = [
  {
    id: "pveproxy",
    label: "pveproxy",
    sub: ":8006 https · www-data",
    color: "#e57000",
    title: "pveproxy: the front door",
    what: "HTTPS server on port 8006 that serves the web UI and the REST API. It runs as the unprivileged www-data user. Calls that need root are forwarded to the local pvedaemon; calls for another node are forwarded to that node's pveproxy.",
    why: "Splitting the internet-facing TLS server from the root-privileged worker limits the damage of a bug in request parsing. It is also why you can talk to any node and manage the whole cluster.",
    files: ["/etc/pve/local/pve-ssl.pem, pveproxy-ssl.pem", "/etc/default/pveproxy  (ALLOW_FROM, ciphers)", "/var/log/pveproxy/access.log"],
    procs: ["pveproxy worker ×3"],
    try: "ss -ltnp | grep 8006\nsystemctl status pveproxy",
  },
  {
    id: "pvedaemon",
    label: "pvedaemon",
    sub: "127.0.0.1:85 · root",
    color: "#e57000",
    title: "pvedaemon: the privileged API worker",
    what: "Runs the API handlers that need root, listening only on 127.0.0.1:85. Long operations (start, migrate, backup, clone) are forked into worker tasks identified by a UPID, with logs in /var/log/pve/tasks/.",
    why: "Every action in the UI shows up in the task list because it is one of these forked workers. The UPID encodes node, PID, start time, task type, guest ID and user, so tasks are traceable across the cluster.",
    files: ["/var/log/pve/tasks/", "/var/log/pve/tasks/active"],
    procs: ["pvedaemon worker ×3", "task UPID:pve1:…:qmstart:100:root@pam:"],
    try: "pvenode task list --limit 5",
  },
  {
    id: "pvestatd",
    label: "pvestatd",
    sub: "status + RRD metrics",
    color: "#38bdf8",
    title: "pvestatd: status collection",
    what: "Every few seconds it collects node, guest and storage status, broadcasts it to the cluster through pmxcfs, writes RRD graphs and feeds configured external metric servers (InfluxDB, Graphite, OpenTelemetry in recent releases).",
    why: "The green/grey icons and graphs in the tree come from here. If pvestatd hangs (often a dead NFS mount), nodes show grey question marks even though guests keep running.",
    files: ["/var/lib/rrdcached/db/", "/etc/pve/status.cfg"],
    procs: ["pvestatd", "rrdcached"],
    try: "systemctl status pvestatd",
  },
  {
    id: "pvescheduler",
    label: "pvescheduler",
    sub: "backup + replication jobs",
    color: "#a78bfa",
    title: "pvescheduler",
    what: "Runs scheduled jobs defined cluster-wide in /etc/pve/jobs.cfg (vzdump backup jobs) and storage replication jobs (ZFS), using systemd-calendar-like schedules.",
    why: "Job definitions live in pmxcfs, so every node knows the schedule, and each node runs the part that concerns its own guests.",
    files: ["/etc/pve/jobs.cfg", "/etc/pve/replication.cfg"],
    procs: ["pvescheduler"],
    try: "pvesh get /cluster/backup\npvesr status",
  },
  {
    id: "ha",
    label: "pve-ha-crm / lrm",
    sub: "HA manager + watchdog",
    color: "#f87171",
    title: "HA stack",
    what: "pve-ha-crm (one active cluster resource manager, elected via a lock in pmxcfs) decides where HA guests should run; pve-ha-lrm on each node executes start/stop/migrate and keeps a watchdog armed through watchdog-mux.",
    why: "If a node loses quorum while running HA guests, its watchdog expires and the node resets itself (self-fencing) before others recover its guests, so a VM never runs twice.",
    files: ["/etc/pve/ha/resources.cfg", "/etc/pve/ha/manager_status"],
    procs: ["pve-ha-crm", "pve-ha-lrm", "watchdog-mux"],
    try: "ha-manager status",
  },
  {
    id: "corosync",
    label: "pve-cluster + corosync",
    sub: "membership · quorum",
    color: "#fbbf24",
    title: "pve-cluster & corosync",
    what: "pve-cluster.service runs pmxcfs; corosync (kronosnet transport, UDP 5405+) provides membership, quorum votes and the ordered messaging that pmxcfs replicates over.",
    why: "Corosync is latency sensitive: put it on its own low-latency link (or two). Migration or backup traffic saturating its network causes token timeouts, nodes leaving the cluster and, with HA, fencing.",
    files: ["/etc/pve/corosync.conf  →  /etc/corosync/corosync.conf", "/etc/corosync/authkey"],
    procs: ["pmxcfs", "corosync"],
    try: "pvecm status\ncorosync-cfgtool -s",
  },
];

const IFACES: Block[] = [
  {
    id: "ui",
    label: "Web UI",
    sub: "https://node:8006",
    color: "#e7e9f0",
    title: "Web UI",
    what: "A single-page ExtJS app served by pveproxy (plus a touch-friendly mobile UI). It has no special back door: every button is a call to the same REST API you can script.",
    why: "Watch the browser devtools network tab: each click is an /api2/json request, which makes the UI the best documentation of which endpoint does what.",
    files: ["/usr/share/pve-manager/"],
    procs: ["(runs in your browser)"],
    try: "open https://pve1:8006",
  },
  {
    id: "api",
    label: "REST API",
    sub: "/api2/json",
    color: "#e7e9f0",
    title: "REST API",
    what: "Resource tree under /api2/json: /nodes/{node}/qemu/{vmid}/…, /cluster/…, /storage, /access. Authenticated with a ticket cookie + CSRF token, or with an API token header. The full schema is browsable at /pve-docs/api-viewer.",
    why: "It's the only real interface. Terraform, Ansible, Packer, the Kubernetes CCM/CSI drivers and the UI all speak it.",
    files: ["/usr/share/pve-docs/api-viewer/"],
    procs: [],
    try: "curl -k https://pve1:8006/api2/json/version",
  },
  {
    id: "cli",
    label: "CLI",
    sub: "qm · pct · pvesh · pvecm · pvesm",
    color: "#e7e9f0",
    title: "Command-line tools",
    what: "qm (VMs), pct (containers), pvesm (storage), pvecm (cluster), ha-manager, vzdump, pveum (users/ACLs), pveceph and pvesh. They call the same Perl API handlers in-process instead of over HTTP.",
    why: "pvesh is the API as a shell: `pvesh get /cluster/resources` is exactly GET /api2/json/cluster/resources. Learn one, you know the other.",
    files: ["/usr/sbin/qm, pct, pvesh, pvecm, pvesm, pveum"],
    procs: [],
    try: "pvesh get /cluster/resources --type vm\nqm start 100",
  },
];

const ALL = [HW, KERNEL, ...ENGINES, PMXCFS, ...SERVICES, ...IFACES];

function Tile({ b, active, onPick, className }: { b: Block; active: boolean; onPick: (id: string) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onPick(b.id)}
      aria-pressed={active}
      className={clsx(
        "group relative min-w-0 overflow-hidden rounded-lg border px-3 py-2 text-left transition",
        active ? "border-transparent bg-panel-2" : "border-line bg-bg/60 hover:border-faint",
        className,
      )}
      style={active ? { boxShadow: `0 0 0 1.5px ${b.color}, 0 0 20px -6px ${b.color}` } : undefined}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: b.color }} />
      <div className="truncate text-[13px] font-medium text-ink">{b.label}</div>
      <div className="truncate font-mono text-[10.5px] text-faint">{b.sub}</div>
    </button>
  );
}

function Row({ label, children, cols }: { label: string; children: React.ReactNode; cols: string }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center">
      <div className="font-mono text-[10px] tracking-wide text-faint uppercase">{label}</div>
      <div className={clsx("grid gap-1.5", cols)}>{children}</div>
    </div>
  );
}

export function StackExplorer() {
  const [sel, setSel] = useState("pmxcfs");
  const b = ALL.find((x) => x.id === sel)!;

  return (
    <Panel title="The Proxmox VE stack: click any layer" right={<span className="text-xs text-faint">bottom = hardware, top = what you touch</span>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <Row label="you" cols="grid-cols-3">
            {IFACES.map((x) => (
              <Tile key={x.id} b={x} active={sel === x.id} onPick={setSel} />
            ))}
          </Row>
          <Row label="services" cols="grid-cols-2 sm:grid-cols-3">
            {SERVICES.map((x) => (
              <Tile key={x.id} b={x} active={sel === x.id} onPick={setSel} />
            ))}
          </Row>
          <Row label="cluster fs" cols="grid-cols-1">
            <Tile b={PMXCFS} active={sel === PMXCFS.id} onPick={setSel} />
          </Row>
          <Row label="engines" cols="grid-cols-2">
            {ENGINES.map((x) => (
              <Tile key={x.id} b={x} active={sel === x.id} onPick={setSel} />
            ))}
          </Row>
          <Row label="os" cols="grid-cols-1">
            <Tile b={KERNEL} active={sel === KERNEL.id} onPick={setSel} />
          </Row>
          <Row label="metal" cols="grid-cols-1">
            <Tile b={HW} active={sel === HW.id} onPick={setSel} />
          </Row>
        </div>

        <div key={b.id} className="min-w-0 animate-rise rounded-xl border border-line bg-bg/50 p-4">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: b.color }} />
            <h3 className="font-semibold">{b.title}</h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">{b.what}</p>
          <div className="mt-3 rounded-lg border-l-2 border-accent bg-panel-2/50 px-3 py-2 text-sm leading-relaxed text-muted">
            <span className="font-medium text-ink">Why: </span>
            {b.why}
          </div>
          {b.files.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] tracking-wide text-faint uppercase">Files</div>
              <ul className="space-y-0.5 font-mono text-[11.5px] text-muted">
                {b.files.map((f) => (
                  <li key={f} className="break-all">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {b.procs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {b.procs.map((p) => (
                <Pill key={p} color={b.color === "#e7e9f0" ? undefined : b.color}>
                  {p}
                </Pill>
              ))}
            </div>
          )}
          <Mono className="mt-3">{b.try}</Mono>
        </div>
      </div>
    </Panel>
  );
}

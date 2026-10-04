import { Fragment } from "react";
import { Code } from "@/components/code/Code";
import { CpuTypePicker } from "@/components/guests/CpuTypePicker";
import { GuestLayers } from "@/components/guests/GuestLayers";
import { OverheadLab } from "@/components/guests/OverheadLab";
import { UidMapper } from "@/components/guests/UidMapper";
import { Callout, Matrix, PageHeader, Section, Takeaways } from "@/components/ui";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/vms-vs-containers");

const QM = `
# qm config 100   →  /etc/pve/qemu-server/100.conf
agent: 1
balloon: 2048
bios: ovmf
boot: order=scsi0
cores: 4
cpu: x86-64-v2-AES
efidisk0: local-lvm:vm-100-disk-1,efitype=4m,pre-enrolled-keys=1,size=4M
machine: q35
memory: 8192
name: web01
net0: virtio=BC:24:11:5E:20:01,bridge=vmbr0,firewall=1
ostype: l26
scsi0: local-lvm:vm-100-disk-0,discard=on,iothread=1,ssd=1,size=32G
scsihw: virtio-scsi-single
`;

const PCT = `
# pct config 101   →  /etc/pve/lxc/101.conf
arch: amd64
cores: 2
features: nesting=1,keyctl=1
hostname: ct-web
memory: 1024
swap: 512
mp0: /tank/media,mp=/srv/media
net0: name=eth0,bridge=vmbr0,hwaddr=BC:24:11:3A:7F:02,ip=dhcp,type=veth
ostype: debian
rootfs: local-lvm:vm-101-disk-0,size=8G
unprivileged: 1
`;

const CREATE = `
# A VM: you bring the OS (ISO or cloud image), Proxmox brings virtual hardware
qm create 100 --name web01 --machine q35 --bios ovmf --cpu x86-64-v2-AES \\
  --cores 4 --memory 8192 --balloon 2048 --scsihw virtio-scsi-single \\
  --scsi0 local-lvm:32,iothread=1,discard=on --efidisk0 local-lvm:1,efitype=4m \\
  --net0 virtio,bridge=vmbr0 --agent 1 --ostype l26 \\
  --ide2 local:iso/debian-13.1.0-amd64-netinst.iso,media=cdrom

# A container: you pick a template, Proxmox unpacks it as the root file system
pveam update && pveam available --section system | grep debian-13
pveam download local debian-13-standard_13.1-2_amd64.tar.zst   # exact name from the list above
pct create 101 local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst \\
  --hostname ct-web --cores 2 --memory 1024 --unprivileged 1 \\
  --features nesting=1 --rootfs local-lvm:8 \\
  --net0 name=eth0,bridge=vmbr0,ip=dhcp --ssh-public-keys ~/.ssh/id_ed25519.pub

qm migrate 100 pve2 --online                 # live: guest keeps running
pct migrate 101 pve2 --restart               # stop → move → start on pve2
`;

const VIRTIO = [
  { k: "virtio-scsi-single + iothread", v: "One SCSI controller per disk, each with its own I/O thread: disk I/O no longer queues behind the main QEMU loop. The default for new Linux VMs." },
  { k: "virtio-net", v: "Paravirtual NIC: the guest driver knows it's virtual and exchanges packets via shared-memory rings (vhost-net in the host kernel) instead of emulating an Intel e1000 register by register." },
  { k: "virtio-balloon", v: "Lets the host reclaim memory the guest isn't using (balloon: min, memory: max) and reports guest memory stats to the UI." },
  { k: "qemu-guest-agent (agent: 1)", v: "A daemon in the guest over a virtio-serial channel: freezes file systems for consistent backups, reports IPs, runs clean shutdowns." },
];

export default function Page() {
  return (
    <>
      <PageHeader n="02" title="KVM vs LXC">
        Proxmox runs two very different kinds of guests from one UI. A <span className="text-ink">VM</span> is a complete
        computer emulated by QEMU and accelerated by KVM: its own firmware, its own kernel, any OS. A{" "}
        <span className="text-ink">container</span> is a group of Linux processes on the host kernel, fenced off with
        namespaces and cgroups. Neither is &quot;better&quot;: the difference is where the isolation boundary sits, and
        that one fact explains the overhead, the security model and what each can do.
      </PageHeader>

      <GuestLayers />

      <Section kicker="overhead" title="Boot time and memory: paying for a kernel">
        Most of a VM&apos;s overhead is not virtualization itself (KVM runs guest code at near-native speed) but the fact
        that every VM boots and maintains a whole operating system.
      </Section>
      <OverheadLab />

      <Section kicker="security" title="Unprivileged containers: root, but not really">
        Proxmox creates containers as <span className="text-ink">unprivileged</span> by default. A user namespace shifts
        every UID by 100000, so the container&apos;s root is an ordinary unprivileged user on the host. Pick a UID and
        see where it lands, then try the bind-mount scenario that trips everyone up.
      </Section>
      <UidMapper />

      <Section kicker="capabilities" title="What each one can and can't do" />
      <Matrix
        columns={["VM (qm / KVM)", "Container (pct / LXC)"]}
        rows={[
          { label: "Guest OS", cells: ["Anything x86-64: Linux, Windows, BSD, appliances", "Linux distributions only (templates via pveam)"] },
          { label: "Kernel", cells: ["Its own, any version", "The host's proxmox-kernel; uname -r shows the host"] },
          { label: "Kernel modules, sysctls", cells: ["Load whatever you want", "Modules must be loaded on the host; only namespaced sysctls"] },
          { label: "Live migration", cells: ["Yes, online (RAM copied while running); local disks too with storage migration", "No. Restart migration: stop, move, start (seconds of downtime)"] },
          { label: "Docker / Kubernetes inside", cells: ["Native, the recommended way", "Works with nesting=1 but officially discouraged: storage drivers, AppArmor and kernel updates can break it"] },
          { label: "Memory", cells: ["Allocated to the guest; ballooning and KSM reclaim some", "A cgroup limit; unused memory stays free for the host"] },
          { label: "Disks", cells: ["Virtual block devices (virtio-scsi), guest formats them", "A file system mounted by the host; bind mounts (mpN) share host directories"] },
          { label: "Hardware passthrough", cells: ["Whole PCIe devices via IOMMU (GPUs, HBAs, NICs)", "Device nodes only (devN: /dev/dri/renderD128)"] },
          { label: "Isolation boundary", cells: ["Hardware virtualization: small, well-audited surface", "Host syscall interface: one kernel bug can affect all CTs"] },
        ]}
      />

      <Section kicker="config" title="The same idea, two config files">
        Both configs live in /etc/pve and use storage volume IDs, so backup, replication and HA treat them alike. The
        difference shows in the keys: a VM describes hardware (machine, bios, scsihw, efidisk), a container describes a
        process environment (unprivileged, features, mount points).
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Code lang="ini" code={QM} title="VM 100" />
        <Code lang="ini" code={PCT} title="CT 101" />
      </div>

      <Section kicker="virtual hardware" title="Choosing a VM's hardware: VirtIO, q35, CPU type">
        For VMs, the defaults matter more than they look. Paravirtual VirtIO devices avoid emulating real hardware, and the
        machine and CPU type define the &quot;computer&quot; the guest believes it is running on, which must stay the same
        when it moves to another node.
      </Section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-line bg-panel p-4">
          <ul className="space-y-3">
            {VIRTIO.map((x) => (
              <li key={x.k} className="text-sm leading-relaxed text-muted">
                <span className="font-mono text-[13px] text-accent">{x.k}</span>
                <br />
                {x.v}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <Callout title="machine: q35 (vs the older i440fx)">
            q35 emulates a modern chipset with native PCIe, which PCIe passthrough and many modern guests expect. The machine
            version (e.g. <span className="font-mono">pc-q35-11.0+pve1</span>) is pinned for Windows guests and on live
            migration, so a QEMU upgrade never changes the hardware the guest sees under its feet.
          </Callout>
          <Callout tone="warn" title="Windows needs drivers">
            Windows has no VirtIO drivers built in: attach the virtio-win ISO during install (or start with SATA + e1000 and
            switch later). Linux has had them in the kernel for over a decade.
          </Callout>
        </div>
      </div>
      <div className="mt-4">
        <CpuTypePicker />
      </div>

      <Section kicker="cli" title="Creating and moving each kind" />
      <Code lang="bash" code={CREATE} title="qm vs pct" />
      <div className="mt-4">
        <Callout title="Containers for app images?">
          For Docker/OCI workloads the Proxmox docs recommend a VM. Proxmox VE 9.1 added the ability to create LXC
          containers from OCI images (system containers from suitable images; application containers are a technology
          preview), but they still run as LXC on the host kernel, not under a Docker daemon.
        </Callout>
      </div>

      <Takeaways
        items={[
          <Fragment key="a">
            The <span className="text-ink">isolation boundary</span> is the whole story: VMs stop at virtual hardware,
            containers at the syscall interface. Overhead, security and capabilities all follow from that.
          </Fragment>,
          <Fragment key="b">
            Keep containers <span className="text-ink">unprivileged</span>. When a bind mount says permission denied, fix the
            UID mapping (lxc.idmap + /etc/subuid), don&apos;t flip the container to privileged.
          </Fragment>,
          <Fragment key="c">
            Pick the <span className="text-ink">CPU type</span> for the cluster, not the node: the newest x86-64-vN level
            every node supports keeps live migration safe; <span className="font-mono">host</span> only for identical CPUs.
          </Fragment>,
        ]}
      />
    </>
  );
}

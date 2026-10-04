import { Fragment } from "react";
import { StackExplorer } from "@/components/architecture/StackExplorer";
import { StartTrace } from "@/components/architecture/StartTrace";
import { Code } from "@/components/code/Code";
import { Callout, PageHeader, Section, Takeaways } from "@/components/ui";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/architecture");

const VMCONF = `
# /etc/pve/qemu-server/100.conf
# (= /etc/pve/nodes/pve1/qemu-server/100.conf)
agent: 1
boot: order=scsi0;net0
cores: 2
cpu: x86-64-v2-AES
machine: q35
memory: 4096
name: web01
net0: virtio=BC:24:11:5E:20:01,bridge=vmbr0,firewall=1
ostype: l26
scsi0: local-lvm:vm-100-disk-0,discard=on,iothread=1,size=32G
scsihw: virtio-scsi-single
`;

const TREE = `
/etc/pve/
├── corosync.conf          # cluster membership (copied to /etc/corosync/)
├── datacenter.cfg         # cluster-wide defaults (keyboard, migration net, …)
├── storage.cfg            # every storage definition, visible to all nodes
├── user.cfg               # users, groups, pools, ACLs
├── jobs.cfg               # backup jobs, run by pvescheduler
├── firewall/cluster.fw
├── ha/resources.cfg
├── priv/                  # root-only: authkey.key, token.cfg, shadow.cfg
├── local -> nodes/pve1    # symlinks resolve to *this* node
├── qemu-server -> nodes/pve1/qemu-server
├── lxc -> nodes/pve1/lxc
└── nodes/
    ├── pve1/{qemu-server/100.conf, lxc/101.conf, pve-ssl.pem}
    └── pve2/{qemu-server/200.conf, …}
`;

const CLI = `
# The same operation, three ways
qm start 100                                          # CLI wrapper
pvesh create /nodes/pve1/qemu/100/status/start        # the API, from a shell
curl -X POST -H "Authorization: PVEAPIToken=root@pam!ops=<secret>" \\
  https://pve1:8006/api2/json/nodes/pve1/qemu/100/status/start

# See what qemu-server would execute, and the running process
qm showcmd 100 --pretty
ps -o pid,nlwp,rss,cmd -C kvm          # one process per VM, nlwp = threads
systemd-cgls /qemu.slice               # each VM in its own scope
`;

export default function Page() {
  return (
    <>
      <PageHeader n="01" title="The stack">
        Proxmox VE is not a monolithic hypervisor. It&apos;s Debian with a custom kernel, the two virtualization engines
        Linux already has (KVM/QEMU for VMs, LXC for containers), a small replicated file system for configuration, and a
        handful of Perl daemons that expose all of it as one REST API. Once you can place each piece, almost every
        Proxmox behaviour, from &quot;why is /etc/pve read-only?&quot; to &quot;why did that VM start on pve2?&quot;, becomes
        obvious.
      </PageHeader>

      <StackExplorer />

      <Section kicker="one click, every layer" title="Follow a Start button through the stack">
        The web UI has no privileged shortcut. Clicking Start is an HTTPS call that crosses a privilege boundary, reads a
        config file from the cluster file system, asks a storage plugin for a block device and finally forks an ordinary
        Linux process. Step through it.
      </Section>
      <StartTrace />

      <Section kicker="the source of truth" title="Configs are small text files in /etc/pve">
        Every guest is described by one file. Because /etc/pve is replicated by pmxcfs, every node sees every file, but a
        guest only runs on the node whose directory contains it. Volume IDs like{" "}
        <code className="font-mono text-ink">local-lvm:vm-100-disk-0</code> keep the file free of node-specific device paths.
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Code lang="ini" code={VMCONF} title="a VM, as Proxmox stores it" />
        <Code lang="text" code={TREE} title="what lives in /etc/pve" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Code lang="bash" code={CLI} title="poking at the layers" />
        <div className="flex flex-col gap-3">
          <Callout tone="warn" title="Don't put data in /etc/pve">
            pmxcfs keeps everything in RAM and replicates every write to every node. It&apos;s built for config files
            (single files are capped at about 1 MiB), not ISOs, logs or scripts that write constantly.
          </Callout>
          <Callout tone="info" title="Editing configs by hand is allowed">
            Editing <code className="font-mono">/etc/pve/qemu-server/100.conf</code> with an editor is supported and takes
            effect on the next start (or as a pending change). Sections in [brackets] below the main config are snapshots.
          </Callout>
        </div>
      </div>

      <Takeaways
        items={[
          <Fragment key="t1">
            A VM is a <span className="text-ink">kvm process</span>, a container is a{" "}
            <span className="text-ink">process tree in namespaces</span>. Standard Linux tools (ps, cgroups, ip, journalctl)
            work on both.
          </Fragment>,
          <Fragment key="t2">
            <span className="text-ink">/etc/pve is the cluster.</span> Ownership, migration and HA all come down to which
            node directory a config file sits in, and pmxcfs refuses writes without quorum to keep that consistent.
          </Fragment>,
          <Fragment key="t3">
            <span className="text-ink">Everything is the API.</span> The UI, qm/pct and pvesh call the same handlers, so
            anything you can click you can script, with the same permission checks.
          </Fragment>,
        ]}
      />
    </>
  );
}

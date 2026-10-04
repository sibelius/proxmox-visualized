import { Fragment } from "react";
import { Callout, PageHeader, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { PrecopySim } from "@/components/migration/PrecopySim";
import { MigrationKinds } from "@/components/migration/MigrationKinds";
import { CpuCompat } from "@/components/migration/CpuCompat";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/migration");

const cmds = `# VM on shared storage: only RAM + device state move
qm migrate 100 pve2 --online

# VM on local disks: mirror the disks too (optionally onto another storage)
qm migrate 101 pve2 --online --with-local-disks --targetstorage local-zfs

# containers: restart mode (stop, move, start)
pct migrate 200 pve2 --restart --timeout 120

# per-VM knobs (qm set): allowed pause, bandwidth cap
qm set 100 --migrate_downtime 0.1     # seconds, default 0.1
qm set 100 --migrate_speed 0          # MiB/s, 0 = unlimited`;

const dc = `# /etc/pve/datacenter.cfg
migration: type=secure,network=10.20.0.0/24
bwlimit: migration=819200       # KiB/s cap for all migrations (~800 MiB/s)`;

const log = `2026-10-04 10:12:01 starting migration of VM 100 to node 'pve2' (10.20.0.12)
2026-10-04 10:12:01 starting VM 100 on remote node 'pve2'
2026-10-04 10:12:03 start remote tunnel
2026-10-04 10:12:04 starting online/live migration on unix:/run/qemu-server/100.migrate
2026-10-04 10:12:04 set migration capabilities
2026-10-04 10:12:04 migration downtime limit: 100 ms
2026-10-04 10:12:05 migration active, transferred 1.1 GiB of 8.0 GiB VM-state, 1.1 GiB/s
2026-10-04 10:12:11 migration active, transferred 7.6 GiB of 8.0 GiB VM-state, 1.1 GiB/s
2026-10-04 10:12:12 average migration speed: 1.0 GiB/s - downtime 41 ms
2026-10-04 10:12:12 migration status: completed
2026-10-04 10:12:15 migration finished successfully (duration 00:00:14)`;

const remote = `# cross-cluster (still marked experimental): the target is reached through its API
qm remote-migrate 100 4100 \\
  'host=pve-b1.example.com,apitoken=PVEAPIToken=root@pam!migrate=<secret>,fingerprint=AB:CD:...' \\
  --target-bridge vmbr0 --target-storage ceph-b --online`;

export default function Page() {
  return (
    <>
      <PageHeader n="06" title="Live migration">
        Live migration moves a running VM to another node with a pause short enough that TCP connections survive. The trick
        is <b className="text-ink">pre-copy</b>: copy all RAM while the guest keeps running, then re-copy only what it changed
        meanwhile, again and again, until the leftover is small enough to send during a pause of about 100&nbsp;ms. It works
        when the link drains memory faster than the guest dirties it, and only then.
      </PageHeader>

      <PrecopySim />

      <Section title="Why it converges, and when it doesn't" kicker="the math">
        Each iteration lasts as long as it takes to send what the previous one left dirty. If the guest dirties{" "}
        <i>d</i>&nbsp;MiB/s and the link carries <i>b</i>&nbsp;MiB/s, each iteration&apos;s leftover is roughly <i>d/b</i> of the
        previous one: with <i>d</i> &lt; <i>b</i> it shrinks geometrically, with <i>d</i> ≥ <i>b</i> it never does. Real guests
        help a bit: they rewrite the same hot pages (the working set), so dirtying saturates. When it still doesn&apos;t
        converge, QEMU&apos;s <b className="text-ink">auto-converge</b> (enabled by Proxmox) throttles the vCPUs, starting at
        20% and stepping up, to slow the writer down, and Proxmox raises the allowed downtime step by step when the remaining
        amount stops shrinking. Try 1&nbsp;GbE with a 300&nbsp;MiB/s dirty rate, with and without auto-converge.
      </Section>

      <MigrationKinds />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Callout tone="info" title="Shared storage is what makes it cheap">
          On Ceph, NFS or iSCSI, both nodes already see the disk; only RAM and device state travel. With local disks
          (<code className="font-mono">--with-local-disks</code>) QEMU&apos;s drive-mirror has to copy every allocated block first,
          so a 500&nbsp;GiB disk turns a 10-second job into an hour. If the disk is ZFS-replicated to the target, only the delta
          since the last replication has to be mirrored.
        </Callout>
        <Callout tone="warn" title="Containers restart">
          LXC has no reliable live migration (checkpoint/restore of arbitrary processes is not production-ready), so{" "}
          <code className="font-mono">pct migrate --restart</code> shuts the CT down, moves it, and boots it again. Without{" "}
          <code className="font-mono">--restart</code>, only stopped CTs can be migrated.
        </Callout>
        <Callout tone="info" title="Give migration its own network">
          By default migration traffic uses the cluster network. Set <code className="font-mono">migration: network=</code> in{" "}
          <code className="font-mono">datacenter.cfg</code> to a fast dedicated CIDR so a 128&nbsp;GiB migration can&apos;t starve
          corosync. <code className="font-mono">type=secure</code> (default) tunnels through SSH;{" "}
          <code className="font-mono">insecure</code> sends RAM unencrypted for more speed: only on a trusted, isolated network.
        </Callout>
      </div>

      <Section title="The guest must not notice a different CPU" kicker="cpu type" />
      <CpuCompat />

      <Section title="Doing it" kicker="cli" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Code code={cmds} title="qm / pct" />
        <div className="space-y-4">
          <Code code={dc} lang="ini" title="cluster-wide migration settings" />
          <Code code={remote} title="to another cluster: qm remote-migrate" />
        </div>
      </div>
      <div className="mt-4">
        <Code code={log} lang="text" title="task log (abridged)" />
      </div>

      <Takeaways
        items={[
          <Fragment key="1">Pre-copy only converges when the link drains memory faster than the guest dirties it. Bandwidth, not RAM size, decides whether you get 40&nbsp;ms or no migration at all.</Fragment>,
          <Fragment key="2">Shared storage turns migration into a RAM copy. Local disks work too, but the disk copy dominates; containers always restart.</Fragment>,
          <Fragment key="3">Pick a CPU type that every node in the cluster supports (e.g. x86-64-v2-AES or v3). <code className="font-mono">host</code> is only safe between identical CPUs.</Fragment>,
        ]}
      />
    </>
  );
}

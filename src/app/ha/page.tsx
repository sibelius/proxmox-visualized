import { Fragment } from "react";
import { Callout, Matrix, PageHeader, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { HaSim } from "@/components/ha/HaSim";
import { ShutdownPolicy } from "@/components/ha/ShutdownPolicy";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/ha");

const cli = `# make guests HA-managed (stored in /etc/pve/ha/resources.cfg)
ha-manager add vm:100 --state started --max_restart 1 --max_relocate 1
ha-manager add ct:103 --state started

# PVE 9: placement is expressed as HA rules (/etc/pve/ha/rules.cfg)
ha-manager rules add node-affinity db-prefers-pve1 \\
    --resources vm:100 --nodes pve1:2,pve2:1 --strict 0
ha-manager rules add node-affinity app-only-pve3-4 \\
    --resources vm:104 --nodes pve3,pve4 --strict 1
ha-manager rules add resource-affinity web-apart \\
    --resources vm:101,vm:102 --affinity negative

ha-manager status            # quorum, master, per-node LRM state, per-service state
ha-manager crm-command node-maintenance enable pve2   # drain a node`;

const rulesCfg = `# /etc/pve/ha/rules.cfg
node-affinity: db-prefers-pve1
	resources vm:100
	nodes pve1:2,pve2:1
	strict 0

node-affinity: app-only-pve3-4
	resources vm:104
	nodes pve3,pve4
	strict 1

resource-affinity: web-apart
	resources vm:101,vm:102
	affinity negative`;

const dcCfg = `# /etc/pve/datacenter.cfg
ha: shutdown_policy=conditional
crs: ha=static,ha-rebalance-on-start=1`;

const status = `$ ha-manager status
quorum OK
master pve1 (active, Sat Oct  3 14:02:11 2026)
lrm pve1 (active, Sat Oct  3 14:02:12 2026)
lrm pve2 (active, Sat Oct  3 14:02:15 2026)
lrm pve3 (idle, Sat Oct  3 14:02:13 2026)
service ct:103 (pve2, started)
service vm:100 (pve1, started)
service vm:101 (pve1, started)`;

export default function Page() {
  return (
    <>
      <PageHeader n="05" title="High availability">
        HA in Proxmox is not magic replication: it is a promise that if a node dies, its HA guests are{" "}
        <b className="text-ink">restarted</b> on another node, from the same shared (or replicated) disk. The hard part is not
        starting them; it is being <b className="text-ink">sure the old copy is gone</b> first. Two daemons do the work:{" "}
        <code className="font-mono">pve-ha-crm</code> (one active cluster-wide manager) and{" "}
        <code className="font-mono">pve-ha-lrm</code> (one per node, holding a lock and feeding a watchdog).
      </PageHeader>

      <HaSim />

      <Section title="Fencing: why recovery waits two minutes" kicker="the reasoning">
        From the rest of the cluster, a powered-off node and a node with a dead network cable look identical: silent. If the
        silent node is actually alive and still writing to a Ceph RBD or an iSCSI LUN, starting the same VM elsewhere means two
        kernels writing one filesystem: guaranteed corruption. Proxmox solves this with <b className="text-ink">self-fencing</b>:
        each LRM holds a lock in <code className="font-mono">/etc/pve</code> and feeds a watchdog through{" "}
        <code className="font-mono">watchdog-mux</code>. A node that loses quorum can&apos;t renew its lock, stops feeding the
        watchdog, and is hard-reset after 60&nbsp;s. The CRM waits until that lock has expired (longer than the watchdog
        timeout), so by the time it can take the lock, the node has already reset itself. No out-of-band power switch needed.
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Callout tone="info" title="Watchdog">
          By default the kernel&apos;s <code className="font-mono">softdog</code> module. For more certainty use a hardware
          watchdog (IPMI, iTCO) via <code className="font-mono">WATCHDOG_MODULE=ipmi_watchdog</code> in{" "}
          <code className="font-mono">/etc/default/pve-ha-manager</code>. Only nodes with active HA services arm it.
        </Callout>
        <Callout tone="warn" title="Requirements">
          At least 3 nodes (or 2 + QDevice) for quorum, guest disks on shared storage (Ceph, NFS, iSCSI) or ZFS replication
          (then you may lose the changes since the last sync), and a reliable, redundant corosync network: a flapping link
          looks like a dead node and gets nodes fenced.
        </Callout>
        <Callout tone="ok" title="PVE 9: groups became rules">
          HA groups were replaced by <b>HA rules</b>. <b>Node affinity</b> rules say which nodes a resource may or should run
          on, with priorities (and <code className="font-mono">strict</code>). <b>Resource affinity</b> rules keep resources
          together (positive) or apart (negative). Existing groups are migrated automatically after the upgrade.
        </Callout>
      </div>

      <Section title="Where recovered services go" kicker="rules + CRS">
        For each service in recovery the CRM first filters nodes by rules: the highest-priority online nodes of its node
        affinity rule (strict rules never fall back to other nodes), minus nodes that violate a negative resource affinity. Among
        the remaining candidates the <b className="text-ink">Cluster Resource Scheduler</b> decides:{" "}
        <code className="font-mono">basic</code> picks the node with the fewest HA services,{" "}
        <code className="font-mono">static</code> weighs the configured CPU and memory of the services against each node&apos;s
        capacity. Switch the simulator between both and fail pve2 to see a different choice for the small services.
      </Section>

      <Matrix
        columns={["Meaning"]}
        rows={[
          { label: "started", cells: ["CRM wants it running; LRM starts it if needed"] },
          { label: "fence", cells: ["its node is gone; wait until the node is provably fenced"] },
          { label: "recovery", cells: ["node fenced; looking for (or waiting for) a new node"] },
          { label: "migrate / relocate", cells: ["moving to another node, online (VM) or stop-start (CT, relocate)"] },
          { label: "freeze", cells: ["do not touch: node is rebooting or updating packages"] },
          { label: "error", cells: ["too many failed start/relocate attempts; needs an admin (set to disabled, fix, re-enable)"] },
        ]}
      />

      <Section title="Planned maintenance is a different path" kicker="shutdown policy" />
      <ShutdownPolicy />

      <Section title="Configuration" kicker="cli" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Code code={cli} title="resources and rules" />
        <div className="space-y-4">
          <Code code={rulesCfg} lang="text" title="rules.cfg" />
          <Code code={dcCfg} lang="ini" title="cluster-wide HA settings" />
          <Code code={status} lang="text" title="ha-manager status" />
        </div>
      </div>

      <Takeaways
        items={[
          <Fragment key="1">HA restarts guests; it does not keep a second copy running. Expect a couple of minutes of downtime and a crash-consistent disk, like after a power cut.</Fragment>,
          <Fragment key="2">Fencing is the whole point. The watchdog guarantees an isolated node kills itself before anyone else starts its guests, so shared disks never see two writers.</Fragment>,
          <Fragment key="3">Everything rests on quorum. A bad corosync network turns HA from a safety net into a source of surprise reboots.</Fragment>,
        ]}
      />
    </>
  );
}

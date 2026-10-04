import { Code } from "@/components/code/Code";
import { CephCapacity } from "@/components/ceph/CephCapacity";
import { CephSim } from "@/components/ceph/CephSim";
import { WritePath } from "@/components/ceph/WritePath";
import { Callout, PageHeader, Panel, Section, Takeaways } from "@/components/ui";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/ceph");

const DAEMONS = [
  {
    name: "MON",
    count: "3 (or 5), odd",
    what: "Keeps the authoritative cluster maps (OSD map, CRUSH map, auth) and agrees on them via Paxos. Needs a majority: 2 of 3 can vote, 1 of 3 cannot. Odd numbers because a 4th mon adds no extra failure tolerance.",
  },
  {
    name: "MGR",
    count: "1 active + standby",
    what: "Metrics, the dashboard, the PG autoscaler and balancer modules. Not in the data path; if the active one dies a standby takes over.",
  },
  {
    name: "OSD",
    count: "one per disk",
    what: "One daemon per disk (BlueStore, writing to the raw device). Stores objects, replicates to peers, heartbeats, and does recovery and backfill.",
  },
  {
    name: "MDS",
    count: "only for CephFS",
    what: "Metadata server for the CephFS filesystem (directories, permissions). RBD block images for VMs do not use it.",
  },
];

const setup = `
# on every node (PVE 9 installs Ceph Squid 19.2)
pveceph install --repository no-subscription

# once: write /etc/pve/ceph.conf (shared by all nodes through pmxcfs)
pveceph init --network 10.10.10.0/24 --cluster-network 10.10.20.0/24

# on three nodes: monitors (+ managers)
pveceph mon create
pveceph mgr create

# on every node, for every empty disk
pveceph osd create /dev/nvme0n1

# a replicated pool for VM disks, registered as PVE storage
pveceph pool create vm-pool --size 3 --min_size 2 --application rbd --add_storages

# optional: CephFS for ISOs / templates
pveceph mds create
pveceph fs create --name cephfs --add-storage

# optional: an erasure-coded pool (k data + m coding chunks)
pveceph pool create ec-pool --erasure-coding k=4,m=2 --add_storages
`;

const conf = `
# /etc/pve/ceph.conf  (→ /etc/ceph/ceph.conf)
[global]
    fsid = 5d8f…
    public_network  = 10.10.10.0/24   # clients (QEMU/librbd), mons, OSD front side
    cluster_network = 10.10.20.0/24   # OSD ↔ OSD replication, recovery, backfill
    mon_host = 10.10.10.1 10.10.10.2 10.10.10.3
    osd_pool_default_size = 3
    osd_pool_default_min_size = 2
`;

const ops = `
ceph -s                         # health, mons in quorum, PG states
ceph osd tree                   # hosts → OSDs, up/down, in/out, weights
ceph osd df tree                # per-OSD fill: watch for the 85% nearfull line
ceph osd pool autoscale-status  # PG counts the autoscaler wants

# where does one object live?
ceph osd map vm-pool rbd_data.1a2b3c4d5e6f.0000000000000007
# osdmap e412 pool 'vm-pool' (2) object 'rbd_data…0007' -> pg 2.8d1f2a1f (2.1f)
#   -> up ([4,9,13], p4) acting ([4,9,13], p4)

# planned maintenance: don't rebalance while a node reboots
ceph osd set noout
reboot
ceph osd unset noout
`;

export default function Page() {
  return (
    <>
      <PageHeader n="12" title="Ceph">
        Ceph turns the local disks of every node into one replicated, self-healing pool. Proxmox runs it <em>hyperconverged</em>: the same nodes run
        VMs and Ceph daemons, all managed with <code className="text-ink">pveceph</code> and the GUI. A VM disk becomes an RBD image, striped
        into 4 MiB objects, each hashed to a <em>placement group</em> that CRUSH maps to OSDs on different hosts. No central table says where
        anything is, so every client can compute it.
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {DAEMONS.map((d) => (
          <div key={d.name} className="animate-rise rounded-xl border border-line bg-panel p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-sm text-accent">{d.name}</span>
              <span className="text-[11px] text-faint">{d.count}</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{d.what}</p>
          </div>
        ))}
      </div>

      <Section title="Break the cluster" kicker="size 3 · min_size 2 · failure domain host">
        A small pool with 32 PGs and 3 copies of each, one copy per host. Click an OSD to kill it, or a host name to kill the whole node. Watch what
        Ceph does, and especially what it waits to do.
      </Section>
      <Panel title="Hyperconverged Ceph simulator">
        <CephSim />
      </Panel>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Callout title="Why wait 10 minutes?">
          A down OSD is not necessarily a dead disk; it may be a reboot. <code>mon_osd_down_out_interval</code> (600 s) gives it time to return
          before Ceph starts copying terabytes. Until then PGs run <em>degraded</em> on the remaining copies.
        </Callout>
        <Callout tone="warn" title="Why min_size 2?">
          With fewer than <code>min_size</code> copies reachable, a PG stops serving I/O. That feels harsh, but the alternative (min_size 1) acknowledges
          writes that exist on exactly one disk, and a second failure loses them.
        </Callout>
        <Callout tone="ok" title="Why only some data moves">
          CRUSH is a deterministic function of the map. Marking one OSD out only remaps the PGs that used it; the rest of the cluster stays put. That
          is what lets Ceph scale without a lookup database.
        </Callout>
      </div>

      <Section title="The write path" kicker="client → primary → replicas → ack">
        Reads go to the primary OSD only. Writes are acknowledged only once every OSD in the acting set has persisted them, which is what makes
        Ceph strongly consistent and why its latency tracks the slowest replica and the network.
      </Section>
      <Panel title="One 4 KiB write from VM 100">
        <WritePath />
      </Panel>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Callout title="Networks">
          The <code>public_network</code> carries client and monitor traffic; an optional <code>cluster_network</code> carries replication and
          recovery so a rebalance does not starve VM I/O. Use at least 10 GbE (25 GbE or more for NVMe OSDs), redundant links, and keep Ceph off the
          corosync network: recovery traffic can saturate a link and corosync needs low latency.
        </Callout>
        <Callout title="Placement groups and the autoscaler">
          PGs are the unit of placement and recovery: too few and data is lumpy and recovery is serial, too many and OSDs waste memory. The PG
          autoscaler (on by default) sizes <code>pg_num</code> per pool, aiming at roughly 100 PGs per OSD; give it a hint with{" "}
          <code>target_size_ratio</code> for pools that will grow.
        </Callout>
      </div>

      <Section title="Capacity: raw is not usable" kicker="replication vs erasure coding">
        Size 3 stores everything three times. Erasure coding with k data and m coding chunks costs (k+m)/k instead (1.5× for 4+2), at the price of
        more CPU, more network round trips for small writes, and needing at least k+m hosts. For VM disks, replicated size 3 is the usual choice;
        EC suits large, colder data. Then leave room to heal: after losing a host, its data must fit on the others.
      </Section>
      <Panel title="How much can I actually store?">
        <CephCapacity />
      </Panel>

      <Section title="Setting it up" kicker="pveceph" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Code code={setup} title="from empty nodes to an RBD storage" />
        <div className="space-y-4">
          <Code code={conf} lang="ini" title="/etc/pve/ceph.conf" />
          <Code code={ops} title="day-2 operations" />
        </div>
      </div>

      <Takeaways
        items={[
          <span key="t1">
            Placement is computed, not looked up: object → hash → PG → CRUSH → OSDs. Any client with the cluster map knows where every object lives,
            and a map change moves only the PGs it affects.
          </span>,
          <span key="t2">
            size 3 / min_size 2 with failure domain host means one node can die with no data loss and no downtime. Use at least 4 nodes if you want
            the cluster to heal itself back to 3 copies; with 3 it waits for the node to return.
          </span>,
          <span key="t3">
            Budget usable capacity at about raw ÷ 3, then keep headroom for a host failure under the 85% nearfull line. Fast, redundant networking
            matters more than anything else for VM latency.
          </span>,
        ]}
      />
    </>
  );
}

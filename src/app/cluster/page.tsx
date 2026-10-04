import { Fragment } from "react";
import { Callout, Matrix, PageHeader, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { QuorumSim } from "@/components/cluster/QuorumSim";
import { PmxcfsDemo } from "@/components/cluster/PmxcfsDemo";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/cluster");

const corosyncConf = `# /etc/pve/corosync.conf  (edit a copy, bump config_version, then move it in place)
logging {
  debug: off
  to_syslog: yes
}

nodelist {
  node {
    name: pve1
    nodeid: 1
    quorum_votes: 1
    ring0_addr: 10.10.10.1     # link0: dedicated corosync network
    ring1_addr: 192.168.1.11   # link1: fallback on another NIC/switch
  }
  node {
    name: pve2
    nodeid: 2
    quorum_votes: 1
    ring0_addr: 10.10.10.2
    ring1_addr: 192.168.1.12
  }
  # ... one block per node
}

quorum {
  provider: corosync_votequorum
}

totem {
  cluster_name: prod
  config_version: 7
  interface {
    linknumber: 0
  }
  interface {
    linknumber: 1
  }
  ip_version: ipv4-6
  link_mode: passive          # knet: use the best working link, fail over on loss
  secauth: on
  version: 2
}`;

const lifecycle = `# on the first node
pvecm create prod --link0 10.10.10.1 --link1 192.168.1.11

# on every other node (it must not contain guests yet)
pvecm add 10.10.10.1 --link0 10.10.10.2 --link1 192.168.1.12

pvecm status        # votequorum view: expected votes, total, quorum, flags
pvecm nodes         # membership with node ids and votes
corosync-cfgtool -n # per-link knet status to every peer`;

const qdevice = `# external host (any Debian box, VM outside the cluster, even a Raspberry Pi)
apt install corosync-qnetd

# on ALL cluster nodes
apt install corosync-qdevice

# on one cluster node: sets up TLS certs and adds the device to corosync.conf
pvecm qdevice setup 10.10.10.50

pvecm status   # now shows "Qdevice" in Flags and an extra vote`;

const expected = `# Last resort, on a node you KNOW is the only one alive:
pvecm expected 1
# votequorum now thinks 1 vote is a majority -> /etc/pve becomes writable.
# If the "dead" nodes are actually alive on the other side of a broken switch
# and someone does the same there, you have two clusters editing one config
# and possibly starting the same VMs on shared storage.`;

export default function Page() {
  return (
    <>
      <PageHeader n="04" title="Cluster & quorum">
        A Proxmox cluster is a group of nodes that share one configuration: <code className="font-mono">/etc/pve</code>.
        Corosync carries every change to every node in a single agreed order, and <b className="text-ink">votequorum</b>{" "}
        decides which nodes are allowed to change anything. The rule is blunt: a group of nodes may write only if it holds{" "}
        <b className="text-ink">more than half of all votes</b>. Two halves can never both have a majority, so two halves can
        never both act.
      </PageHeader>

      <QuorumSim />

      <Section title="Why “more than half” and not “whoever is alive”" kicker="the reasoning">
        A node can&apos;t distinguish &ldquo;my peers crashed&rdquo; from &ldquo;the cable between us is cut&rdquo;. In both
        cases it simply stops hearing them. If every group that still runs were allowed to act, a broken switch would turn one
        cluster into two, each starting the same VMs against the same shared disk. Majority is the cheapest rule that makes
        that impossible without any node needing to know what the others see. The price: with an even split, nobody gets a
        majority, and with two nodes, losing either one stops changes. That is what a QDevice is for.
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Callout tone="info" title="QDevice: an outside vote, not a node">
          <code className="font-mono">corosync-qnetd</code> runs on a host outside the cluster; every node runs{" "}
          <code className="font-mono">corosync-qdevice</code> and talks to it over TCP (port 5403). On a split it hands its vote
          to one partition only. With an even node count Proxmox uses the <b>ffsplit</b> algorithm (1 vote, larger partition wins,
          tie goes to the lowest node id). It needs no low latency, so it can live in another building.
        </Callout>
        <Callout tone="warn" title="Corosync is latency-sensitive">
          Totem passes a token around all nodes; if it isn&apos;t seen within the token timeout, membership is recomputed. Keep
          corosync under about 5&nbsp;ms (LAN latency, not WAN), on its own physical network. A saturated storage or backup
          link causes token loss, node &ldquo;fencing storms&rdquo; with HA, and phantom quorum loss. Give it a second{" "}
          <code className="font-mono">link1</code> as a fallback; knet fails over between links on its own.
        </Callout>
      </div>

      <Section title="pmxcfs: the cluster filesystem that is really a replicated database" kicker="/etc/pve">
        <code className="font-mono">/etc/pve</code> is a FUSE mount provided by <code className="font-mono">pmxcfs</code>{" "}
        (the <code className="font-mono">pve-cluster</code> service). Its content lives in RAM and is persisted to SQLite at{" "}
        <code className="font-mono">/var/lib/pve-cluster/config.db</code> on every node. It is built for small config files:
        guest configs, storage.cfg, user.cfg, firewall rules, HA state, certificates. Because every write is a totem message,
        all nodes see the same files in the same order, and locks taken there (HA, migrations) are cluster-wide.
      </Section>

      <PmxcfsDemo />

      <Section title="Building and inspecting a cluster" kicker="cli" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Code code={lifecycle} title="create, join, inspect" />
        <Code code={qdevice} title="add a QDevice (even-sized clusters)" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Code code={corosyncConf} lang="text" title="/etc/pve/corosync.conf" />
        <div className="space-y-4">
          <Code code={expected} title="the dangerous override" />
          <Matrix
            columns={["Quorate", "Not quorate"]}
            rows={[
              { label: "/etc/pve", cells: ["read-write", "read-only (writes: Permission denied)"] },
              { label: "start / create guests", cells: ["yes", "no"] },
              { label: "running guests", cells: ["keep running", "keep running; HA nodes self-fence"] },
              { label: "web UI / API", cells: ["full", "reads work, changes fail"] },
            ]}
          />
        </div>
      </div>

      <Takeaways
        items={[
          <Fragment key="1">Quorum is a strict majority of expected votes. It guarantees that at most one part of a split cluster can change configuration or start guests.</Fragment>,
          <Fragment key="2">Even clusters, and two-node clusters most of all, need a tie-breaker. A QDevice adds one vote from outside without becoming a full node.</Fragment>,
          <Fragment key="3">Corosync needs low, stable latency and its own redundant links. A flapping corosync network is the most common root cause of &ldquo;random&rdquo; cluster and HA trouble.</Fragment>,
        ]}
      />
    </>
  );
}

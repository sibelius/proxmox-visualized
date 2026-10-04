import { Code } from "@/components/code/Code";
import { RuleEvaluator } from "@/components/firewall/RuleEvaluator";
import { Callout, Matrix, PageHeader, Section, Takeaways } from "@/components/ui";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/firewall");

const CLUSTER = `
[OPTIONS]
enable: 1
policy_in: DROP
policy_out: ACCEPT

[ALIASES]
admin_laptop 192.168.10.5

[IPSET management]
admin_laptop

[IPSET blocklist]
203.0.113.0/24

[RULES]
IN DROP -source +blocklist
# IN ACCEPT -source 10.8.0.0/24 -p tcp -dport 8006   # add BEFORE enabling if you manage via VPN

[group webserver]
IN DROP -source +blocklist
IN ACCEPT -p tcp -dport 80
IN ACCEPT -p tcp -dport 443
`;

const HOST = `
[OPTIONS]
enable: 1
nftables: 1          # opt in to proxmox-firewall on this node

[RULES]
IN ACCEPT -source +local_network -p tcp -dport 9100   # node_exporter
`;

const VM = `
[OPTIONS]
enable: 1
policy_in: DROP
policy_out: ACCEPT
ipfilter: 1
macfilter: 1

[IPSET ipfilter-net0]
192.168.10.50

[RULES]
GROUP webserver -i net0
IN SSH(ACCEPT) -source admin_laptop -i net0
IN ACCEPT -p icmp
OUT DROP -p tcp -dport 25
`;

const CLI = `
pve-firewall status            # running / enabled?
pve-firewall localnet          # what local_network resolved to
pve-firewall compile           # print the generated ruleset (iptables backend)

# nftables backend (after setting nftables: 1 in host.fw)
systemctl status proxmox-firewall
nft list ruleset | less

# locked out? from the console / IPMI:
pve-firewall stop
`;

export default async function Page() {
  return (
    <>
      <PageHeader n="09" title="Firewall">
        Proxmox has a built-in, cluster-aware firewall. Rules live in plain text files in{" "}
        <span className="font-mono">/etc/pve/firewall/</span>, so pmxcfs copies them to every node, and each node turns them
        into kernel rules for itself and for the guests it runs. Guest rules follow a VM when it migrates. There are three
        levels (datacenter, node, guest), plus reusable security groups, IP sets and aliases. In each chain the first
        matching rule wins.
      </PageHeader>

      <RuleEvaluator />

      <Section title="Where each rule lives" kicker="levels">
        A common mistake: rules in <span className="font-mono">cluster.fw</span> do not filter VM traffic. They apply to
        the <i>hosts</i> (merged with each node&apos;s host.fw, host rules first). Guests are filtered only by their own{" "}
        <span className="font-mono">&lt;vmid&gt;.fw</span>, which can pull in security groups that are <i>defined</i> at
        the datacenter level.
      </Section>
      <Matrix
        columns={["File", "Filters", "Notes"]}
        rows={[
          { label: "Datacenter", cells: [<span key="a" className="font-mono">/etc/pve/firewall/cluster.fw</span>, "traffic to/from every node", "master switch enable: 0|1 (default 0); default input DROP, output ACCEPT; defines groups, IP sets, aliases"] },
          { label: "Node", cells: [<span key="b" className="font-mono">/etc/pve/nodes/&lt;node&gt;/host.fw</span>, "that node only", "evaluated before the datacenter rules; per-node options (nftables, log levels, conntrack limits)"] },
          { label: "Guest", cells: [<span key="c" className="font-mono">/etc/pve/firewall/&lt;vmid&gt;.fw</span>, "NICs with firewall=1", "own enable (default 0), policies, ipfilter/macfilter, IP sets like ipfilter-net0"] },
          { label: "Security group", cells: [<span key="d" className="font-mono">[group name]</span>, "nothing on its own", "a named list of rules, inserted wherever a GROUP name rule appears"] },
          { label: "IP set / alias", cells: [<span key="e" className="font-mono">+name / name</span>, "—", "reusable address lists; management, blocklist and ipfilter-netX have special meaning"] },
          { label: "VNet (nftables)", cells: [<span key="f" className="font-mono">/etc/pve/sdn/firewall/&lt;vnet&gt;.fw</span>, "forwarded traffic", "only with the nftables backend; FORWARD direction"] },
        ]}
      />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Code code={CLUSTER} lang="ini" title="/etc/pve/firewall/cluster.fw" />
        <Code code={HOST} lang="ini" title="/etc/pve/nodes/pve1/host.fw" />
        <Code code={VM} lang="ini" title="/etc/pve/firewall/100.fw" />
      </div>

      <Section title="Don't lock yourself out" kicker="enable at datacenter level">
        Setting <span className="font-mono">enable: 1</span> in cluster.fw switches every node to input policy DROP. To
        keep the cluster working, Proxmox adds some rules itself: established connections, corosync (UDP 5405-5412)
        between nodes, migration ports, and management access (8006 GUI, 22 SSH, 5900-5999 VNC, 3128 SPICE) from the{" "}
        <span className="font-mono">management</span> IP set and the node&apos;s local network. Anyone outside those
        ranges, like an admin on a VPN subnet, is dropped. Try it in the evaluator: node pve1, source 10.8.0.2, port 8006.
      </Section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Callout tone="bad" title="Order matters, built-ins come last">
            The automatic management rules come after your own host and datacenter rules. A broad{" "}
            <span className="font-mono">IN DROP</span> that you write is checked first, so it can block 8006 even from the
            LAN. Put allow rules first, and check <span className="font-mono">pve-firewall localnet</span> before you enable
            the firewall.
          </Callout>
          <Callout tone="info" title="Anti-spoofing: ipfilter and macfilter">
            <span className="font-mono">macfilter</span> (on by default) drops frames from a guest whose source MAC isn&apos;t
            the NIC&apos;s configured MAC. With <span className="font-mono">ipfilter: 1</span>, outgoing packets whose
            source IP is not in <span className="font-mono">ipfilter-net0</span> (one set per NIC) are dropped. Containers
            get their configured IPs added automatically, plus the MAC-derived IPv6 link-local address. That stops a
            tenant from stealing another guest&apos;s IP.
          </Callout>
        </div>
        <Code code={CLI} lang="bash" title="checking and recovering" />
      </div>

      <Section title="iptables today, nftables next" kicker="pve-firewall vs proxmox-firewall">
        The classic <span className="font-mono">pve-firewall</span> generates iptables rules (via the iptables-nft
        compatibility layer on Debian 13). Its successor <span className="font-mono">proxmox-firewall</span>, written in
        Rust, generates native nftables rules. It has been opt-in per node since PVE 8.2 (<span className="font-mono">nftables: 1</span>{" "}
        in host.fw) and is still marked tech preview in the PVE 9 docs, while it moves toward becoming the default. It
        reads the same config files, so you can switch per node and back. It drops the fwbr detour for Linux bridges and
        adds forward-direction rules and VNet firewalls for SDN.
      </Section>

      <Takeaways
        items={[
          "Rules are evaluated top to bottom and the first match wins, then the policy applies. Host traffic sees host.fw, then cluster.fw, then the built-in management rules. Guest traffic sees only its own <vmid>.fw (security groups are inserted inline).",
          "Enabling the datacenter firewall means input DROP everywhere. Management access only survives for the management IP set and the local network, so add rules for VPN or jump hosts first, and keep console access ready.",
          "Turn on ipfilter and keep macfilter on for multi-tenant guests. Without them a VM can claim any IP or MAC on the bridge. The nftables backend also removes the per-NIC fwbr bridges.",
        ]}
      />
    </>
  );
}

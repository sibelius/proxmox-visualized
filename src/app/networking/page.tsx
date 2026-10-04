import { Code } from "@/components/code/Code";
import { HostingModes } from "@/components/networking/HostingModes";
import { NetworkSeparation } from "@/components/networking/NetworkSeparation";
import { PacketPath } from "@/components/networking/PacketPath";
import { Callout, Matrix, PageHeader, Section, Takeaways } from "@/components/ui";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/networking");

const ROUTED = `
auto eno1
iface eno1 inet static
    address 198.51.100.5/29
    gateway 198.51.100.1
    post-up echo 1 > /proc/sys/net/ipv4/ip_forward
    post-up echo 1 > /proc/sys/net/ipv4/conf/eno1/proxy_arp

# extra subnet routed to 198.51.100.5 by the hoster
auto vmbr0
iface vmbr0 inet static
    address 203.0.113.17/28
    bridge-ports none
    bridge-stp off
    bridge-fd 0
`;

const NAT = `
auto vmbr1
iface vmbr1 inet static
    address 10.10.10.1/24
    bridge-ports none
    bridge-stp off
    bridge-fd 0
    post-up   echo 1 > /proc/sys/net/ipv4/ip_forward
    post-up   iptables -t nat -A POSTROUTING -s '10.10.10.0/24' -o eno1 -j MASQUERADE
    post-down iptables -t nat -D POSTROUTING -s '10.10.10.0/24' -o eno1 -j MASQUERADE
    # needed when the Proxmox firewall is on, so conntrack sees both directions
    post-up   iptables -t raw -I PREROUTING -i fwbr+ -j CT --zone 1
    post-down iptables -t raw -D PREROUTING -i fwbr+ -j CT --zone 1
`;

const BRIDGED = `
# the default installer layout: vmbr0 owns the host IP and the NIC
auto vmbr0
iface vmbr0 inet static
    address 198.51.100.5/29
    gateway 198.51.100.1
    bridge-ports eno1
    bridge-stp off
    bridge-fd 0
`;

const OVS = `
# apt install openvswitch-switch   (ifupdown2 understands ovs_* options)
auto bond0
iface bond0 inet manual
    ovs_bridge vmbr0
    ovs_type OVSBond
    ovs_bonds eno1 eno2
    ovs_options bond_mode=balance-tcp lacp=active other_config:lacp-time=fast

auto vmbr0
iface vmbr0 inet manual
    ovs_type OVSBridge
    ovs_ports bond0 mgmt

# host IP lives on an internal port, tagged VLAN 10
auto mgmt
iface mgmt inet static
    ovs_type OVSIntPort
    ovs_bridge vmbr0
    ovs_options tag=10
    address 192.168.10.11/24
    gateway 192.168.10.1
`;

const SEPARATION = `
# /etc/pve/corosync.conf (excerpt): two independent links
nodelist {
  node {
    name: pve1
    nodeid: 1
    ring0_addr: 10.10.1.11      # link0: dedicated NIC
    ring1_addr: 192.168.10.11   # link1: fallback over mgmt
  }
}

# /etc/pve/datacenter.cfg: send migrations over their own network
migration: secure,network=10.10.3.0/24

# /etc/pve/ceph.conf (excerpt)
[global]
    public_network  = 10.10.2.0/24
    cluster_network = 10.10.2.0/24
`;

const JUMBO = `
# verify jumbo frames end to end: 9000 - 20 (IP) - 8 (ICMP) = 8972
ping -M do -s 8972 10.10.2.12
# "message too long" or silence = something in the path is still at 1500
`;

export default async function Page() {
  const snippets = {
    bridged: <Code code={BRIDGED} lang="ini" title="/etc/network/interfaces" />,
    routed: <Code code={ROUTED} lang="ini" title="/etc/network/interfaces" />,
    nat: <Code code={NAT} lang="ini" title="/etc/network/interfaces" />,
  };

  return (
    <>
      <PageHeader n="07" title="Bridges, VLANs & bonds">
        A VM&apos;s network card is a software device. Its frames travel through a tap device, maybe a firewall detour, a
        Linux bridge that works like a switch inside the kernel, a bond that spreads traffic over several cables, and only
        then reach real hardware. Proxmox VE 9 configures all of it in <span className="font-mono">/etc/network/interfaces</span>{" "}
        with ifupdown2. Each toggle below changes which devices a frame passes through and where the VLAN tag gets added.
      </PageHeader>

      <PacketPath />

      <Section title="Why a VLAN-aware bridge" kicker="one bridge, 4094 networks">
        The traditional way creates a bridge and a sub-interface for every VLAN a VM uses. With{" "}
        <span className="font-mono">bridge-vlan-aware yes</span>, one bridge carries every VLAN: each VM port gets a PVID
        (its access VLAN) and the uplink is a trunk. Changing a VM&apos;s tag becomes one field in its config. Because the
        host adds and removes the tag, a guest cannot send frames into other VLANs, unless you give it a trunk on purpose
        (<span className="font-mono">trunks=20;30</span> on the NIC).
      </Section>

      <Section title="Single public IP? Routed or NAT" kicker="dedicated-server hosters">
        At home or in your own rack, bridging is the default and the best choice. A rented server is different: the
        hoster&apos;s switch usually accepts only your server&apos;s MAC address. Pick a mode to see why the default
        layout breaks there and what the two common fixes look like.
      </Section>
      <HostingModes snippets={snippets} />

      <Section title="Open vSwitch: the alternative" kicker="when Linux bridges aren't enough">
        Proxmox also supports Open vSwitch (OVS) bridges in the same file. Linux bridges with VLAN awareness now cover what
        most clusters need and are the default; OVS fits when you need OpenFlow, OVS-native LACP (balance-tcp) or a team
        that already runs OVS. Note that Proxmox SDN and the nftables firewall are built around Linux bridges.
      </Section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Matrix
          columns={["Linux bridge", "Open vSwitch"]}
          rows={[
            { label: "Package", cells: ["in the kernel, nothing to install", "openvswitch-switch daemon"] },
            { label: "VLANs", cells: ["bridge-vlan-aware yes", "native, tag= per port"] },
            { label: "Bonding", cells: ["kernel bonding driver", "OVSBond (balance-slb, balance-tcp)"] },
            { label: "Guest firewall", cells: ["direct (nftables) or fwbr (iptables)", "always via fwbr"] },
            { label: "Debugging", cells: ["ip, bridge, tcpdump", "ovs-vsctl, ovs-appctl, ovs-ofctl"] },
          ]}
        />
        <Code code={OVS} lang="ini" title="/etc/network/interfaces (OVS variant)" />
      </div>

      <Section title="Separate the traffic that must never wait" kicker="management vs corosync vs storage vs migration">
        One cluster carries several kinds of traffic with very different needs. Corosync needs almost no bandwidth, but it
        needs low, steady latency: Proxmox asks for under 5 ms between nodes. Ceph recovery and live migration are the
        opposite: they use all the bandwidth they get. If they share a link, the bulk traffic decides when corosync&apos;s
        packets leave.
      </Section>
      <NetworkSeparation />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Code code={SEPARATION} lang="ini" title="where each network is chosen" />
        <div className="flex flex-col gap-4">
          <Callout tone="info" title="MTU 9000 (jumbo frames)">
            Larger frames mean fewer packets and fewer interrupts per gigabyte, which helps Ceph and migration traffic. The
            MTU must match on every hop: NICs, bond, bridge, VLAN interfaces and every switch port. If one hop stays at
            1500, small packets pass (ping works, SSH works) and large ones are dropped, so the failure looks random.
            Corosync gains nothing from jumbo frames; keep its network simple.
          </Callout>
          <Code code={JUMBO} lang="bash" title="test the path" />
          <Callout tone="warn" title="Bonds carrying corosync">
            Proxmox only supports active-backup for a bond that carries corosync. Better still: no bond at all, and two
            corosync links on two separate NICs, because corosync (kronosnet) switches links by itself.
          </Callout>
        </div>
      </div>

      <Takeaways
        items={[
          "A VM's frame goes eth0 → tap → (fwbr when the iptables firewall is on) → bridge → bond → NIC. When something breaks, check each of these devices in order with ip link and tcpdump.",
          "Use VLAN-aware bridges: the host adds and removes 802.1Q tags at the bridge port, guests can't leave their VLAN, and one trunk serves every VLAN. LACP spreads separate flows over the links; a single flow still uses only one link.",
          "Give corosync its own quiet link (two, ideally) and move Ceph and migration to fast, separate networks with matching MTU. Shared links turn a storage recovery into HA fencing.",
        ]}
      />
    </>
  );
}

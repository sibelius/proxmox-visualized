import type { ReactNode } from "react";
import { Code } from "@/components/code/Code";
import { ApplyFlow } from "@/components/sdn/ApplyFlow";
import { ZoneTopology, type Zone } from "@/components/sdn/ZoneTopology";
import { Callout, Matrix, PageHeader, Section, Takeaways } from "@/components/ui";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/sdn");

const CFG: Record<Zone, string> = {
  simple: `
# /etc/pve/sdn/zones.cfg
simple: lab
        dhcp dnsmasq
        ipam pve

# /etc/pve/sdn/vnets.cfg
vnet: vnet1
        zone lab

# /etc/pve/sdn/subnets.cfg
subnet: lab-10.0.20.0-24
        vnet vnet1
        gateway 10.0.20.1
        snat 1
        dhcp-range start-address=10.0.20.100,end-address=10.0.20.200
`,
  vlan: `
# /etc/pve/sdn/zones.cfg
vlan: office
        bridge vmbr0
        ipam pve

# /etc/pve/sdn/vnets.cfg
vnet: vnet1
        zone office
        tag 20

# /etc/pve/sdn/subnets.cfg   (gateway = your physical router)
subnet: office-10.0.20.0-24
        vnet vnet1
        gateway 10.0.20.1
`,
  qinq: `
# /etc/pve/sdn/zones.cfg
qinq: tenant1
        bridge vmbr0
        tag 100
        vlan-protocol 802.1ad
        mtu 1496
        ipam pve

# /etc/pve/sdn/vnets.cfg
vnet: vnet1
        zone tenant1
        tag 20
`,
  vxlan: `
# /etc/pve/sdn/zones.cfg
vxlan: overlay
        peers 10.10.5.11,10.10.5.12,10.10.5.13
        mtu 1450
        ipam pve

# /etc/pve/sdn/vnets.cfg
vnet: vnet1
        zone overlay
        tag 100000

# generated on pve1 → /etc/network/interfaces.d/sdn
auto vxlan_vnet1
iface vxlan_vnet1
        vxlan-id 100000
        vxlan_remoteip 10.10.5.12
        vxlan_remoteip 10.10.5.13
        mtu 1450

auto vnet1
iface vnet1
        bridge_ports vxlan_vnet1
        bridge_stp off
        bridge_fd 0
        mtu 1450
`,
  evpn: `
# /etc/pve/sdn/controllers.cfg
evpn: evpnctl
        asn 65000
        peers 10.10.5.11,10.10.5.12,10.10.5.13

# /etc/pve/sdn/zones.cfg
evpn: prod
        controller evpnctl
        vrf-vxlan 10000
        exitnodes pve3
        mtu 1450
        ipam pve

# /etc/pve/sdn/vnets.cfg
vnet: vnet1
        zone prod
        tag 100000

# /etc/pve/sdn/subnets.cfg  (gateway is configured on EVERY node)
subnet: prod-10.0.20.0-24
        vnet vnet1
        gateway 10.0.20.1
`,
};

const VM = `
# a VNet is used like any bridge
qm set 100 --net0 virtio,bridge=vnet1

# apply pending SDN changes from the CLI
pvesh set /cluster/sdn

# inspect what got generated
cat /etc/network/interfaces.d/sdn
vtysh -c "show bgp l2vpn evpn summary"     # EVPN zones
`;

export default async function Page() {
  const configs = Object.fromEntries(
    await Promise.all(
      (Object.keys(CFG) as Zone[]).map(async (z) => [z, <Code key={z} code={CFG[z]} lang="ini" title={`${z} zone · /etc/pve/sdn/*.cfg`} />] as const),
    ),
  ) as Record<Zone, ReactNode>;

  return (
    <>
      <PageHeader n="08" title="SDN zones & VNets">
        Bridges and VLANs in <span className="font-mono">/etc/network/interfaces</span> are configured one node at a time.
        Proxmox SDN (installed and enabled by default since PVE 8.1) defines virtual networks once for the whole cluster.
        A <b className="text-ink">zone</b> chooses how traffic crosses between nodes, a <b className="text-ink">VNet</b> is
        one network in that zone that guests plug into, and a <b className="text-ink">subnet</b> adds IP addressing, a
        gateway and optionally DHCP. Pick a zone type to see how VM 100 on pve1 reaches VM 200 on pve2.
      </PageHeader>

      <ZoneTopology configs={configs} />

      <Section title="Zones at a glance" kicker="choose by what your underlay can do">
        The key question is what the physical network gives you. If the switches carry VLANs, VLAN zones are the simplest.
        If you only have routed IP between nodes (another rack, another site, or a hoster), use VXLAN or EVPN.
      </Section>
      <Matrix
        columns={["Simple", "VLAN", "QinQ", "VXLAN", "EVPN"]}
        rows={[
          { label: "Crosses nodes", cells: ["no (routed/SNAT only)", "yes, via switch", "yes, via switch", "yes, UDP 4789", "yes, UDP 4789"] },
          { label: "Underlay needs", cells: ["nothing", "VLAN trunk", "S-VLAN trunk", "IP reachability", "IP reachability"] },
          { label: "Isolation IDs", cells: ["per node", "4094", "4094 × 4094", "16M VNIs", "16M VNIs + VRFs"] },
          { label: "MTU cost", cells: ["0", "0", "4 bytes", "50 bytes", "50 bytes"] },
          { label: "Gateway", cells: ["on each node", "external router", "external router", "external router", "anycast on every node"] },
          { label: "MAC learning", cells: ["local bridge", "switch", "switch", "flood to peers", "BGP announcements"] },
        ]}
      />

      <Section title="Apply: how config becomes interfaces" kicker="pending → running">
        SDN does not replace ifupdown2. It generates config for it. That&apos;s why you can debug any SDN network with
        the usual tools (<span className="font-mono">ip -d link</span>, <span className="font-mono">bridge fdb</span>,{" "}
        <span className="font-mono">tcpdump -i vnet1</span>).
      </Section>
      <ApplyFlow />

      <Section title="IPAM, DHCP and DNS" kicker="who hands out the addresses">
        Subnets can be tracked by an IPAM plugin. When a guest gets a NIC on a VNet with a subnet, Proxmox can reserve
        an IP for its MAC and, in zones with DHCP enabled, serve it.
      </Section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Matrix
          columns={["What it does", "Notes"]}
          rows={[
            { label: "pve IPAM", cells: ["built-in, stored in pmxcfs", "default; shown in the GUI's IPAM view"] },
            { label: "NetBox", cells: ["external IPAM via its API", "NetBox stays the source of truth"] },
            { label: "phpIPAM", cells: ["external IPAM via its API", "section/subnet must already exist"] },
            { label: "DHCP", cells: ["dnsmasq instance per zone", "Simple zones; install dnsmasq first"] },
            { label: "DNS", cells: ["PowerDNS plugin", "creates A/PTR records for guests"] },
          ]}
        />
        <div className="flex flex-col gap-4">
          <Code code={VM} lang="bash" title="using it" />
          <Callout tone="warn" title="Tech-preview edges">
            The IPAM/DHCP integration is still marked tech preview in the docs. DHCP leases come from IPAM mappings, not
            from a dynamic pool, so a guest NIC created outside Proxmox&apos;s knowledge gets nothing.
          </Callout>
        </div>
      </div>

      <Section title="EVPN in one paragraph" kicker="controllers, VRFs, exit nodes">
        An <span className="font-mono">evpn</span> controller makes Proxmox write an FRR config on every node: BGP sessions
        to the peers, with the l2vpn evpn address family. Each EVPN zone is a VRF with its own L3 VNI (
        <span className="font-mono">vrf-vxlan</span>), so subnets of the zone can route to each other directly on the
        local node, and tenants in different zones stay separated. To leave the overlay, traffic goes to the{" "}
        <b className="text-ink">exit nodes</b>, which announce a default route into the zone and route (optionally SNAT)
        toward the physical network. Optionally, a <span className="font-mono">bgp</span> controller peers with your real
        routers.
      </Section>

      <Section title="PVE 9: fabrics for the underlay" kicker="new in 9.x">
        VXLAN and EVPN need IP routes between all nodes&apos; VTEP addresses. Before 9.0 you configured that underlay by
        hand. Proxmox VE 9.0 added SDN <b className="text-ink">fabrics</b>: you list the nodes and their interfaces, and
        Proxmox configures <b className="text-ink">OpenFabric</b> or <b className="text-ink">OSPF</b> in FRR so every node
        learns routes to every other node&apos;s loopback. This works well with full-mesh links that have no switch (for
        example a 3-node Ceph mesh). An EVPN controller can then use the fabric as its underlay. Later 9.x releases add
        more fabric protocols; check the release notes for your version.
      </Section>

      <Takeaways
        items={[
          "Zone = how VNet traffic crosses nodes. Simple stays on one node, VLAN and QinQ rely on switch tags, VXLAN and EVPN wrap frames in UDP 4789 and only need routed IP between nodes.",
          "Every encapsulation costs MTU: 4 bytes for QinQ, 50 bytes for VXLAN/EVPN. Lower the VNet MTU or raise the underlay MTU, or large packets will be dropped while small ones work.",
          "SDN edits are pending until Apply. Each node then writes its own /etc/network/interfaces.d/sdn (and FRR config) and runs ifreload, so you can debug VNets with the usual Linux tools.",
        ]}
      />
    </>
  );
}

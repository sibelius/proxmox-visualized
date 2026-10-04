export type NavItem = { href: string; label: string; blurb: string; n: string; group: string };

export const NAV: NavItem[] = [
  { href: "/", label: "Overview", blurb: "The whole stack on one page", n: "00", group: "Start" },
  { href: "/architecture", label: "The stack", blurb: "Debian, KVM, LXC, pmxcfs, the API", n: "01", group: "Foundations" },
  { href: "/vms-vs-containers", label: "KVM vs LXC", blurb: "Two kinds of guests, side by side", n: "02", group: "Foundations" },
  { href: "/templates", label: "Templates & cloud-init", blurb: "Linked clones and first-boot config", n: "03", group: "Foundations" },
  { href: "/cluster", label: "Cluster & quorum", blurb: "Corosync votes and /etc/pve", n: "04", group: "Cluster" },
  { href: "/ha", label: "High availability", blurb: "Fencing, watchdogs, recovery", n: "05", group: "Cluster" },
  { href: "/migration", label: "Live migration", blurb: "Moving RAM while the guest runs", n: "06", group: "Cluster" },
  { href: "/networking", label: "Bridges, VLANs & bonds", blurb: "How a packet leaves a VM", n: "07", group: "Network" },
  { href: "/sdn", label: "SDN zones & VNets", blurb: "VLAN, QinQ, VXLAN, EVPN", n: "08", group: "Network" },
  { href: "/firewall", label: "Firewall", blurb: "Datacenter, node and guest rules", n: "09", group: "Network" },
  { href: "/storage", label: "Storage types", blurb: "Dir, LVM-thin, ZFS, Ceph, NFS…", n: "10", group: "Storage" },
  { href: "/zfs", label: "ZFS", blurb: "vdevs, RAIDZ, ARC, replication", n: "11", group: "Storage" },
  { href: "/ceph", label: "Ceph", blurb: "OSDs, PGs, CRUSH and recovery", n: "12", group: "Storage" },
  { href: "/backup", label: "Backups & PBS", blurb: "vzdump modes, chunks, dedup", n: "13", group: "Operations" },
  { href: "/api", label: "API, users & automation", blurb: "Tokens, ACLs, Terraform", n: "14", group: "Operations" },
  { href: "/kubernetes", label: "Proxmox + Kubernetes", blurb: "Where CCM and CSI plug in", n: "15", group: "Operations" },
];

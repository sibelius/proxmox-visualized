# Proxmox, visualized

An interactive Next.js site that teaches how **Proxmox VE** works — with live diagrams and simulators, not slides.

Live: https://proxmox-visualized.vercel.app · Sister site: [Talos, visualized](https://github.com/sibelius/talos-visualized)

## Pages

| # | Page | What you can play with |
|---|------|------------------------|
| 01 | **The stack** | Clickable layer diagram (kernel, KVM, LXC, pmxcfs, services) and a trace of "Start VM 100" |
| 02 | **KVM vs LXC** | Guest kernel vs shared kernel, overhead, unprivileged UID mapping |
| 03 | **Templates & cloud-init** | Full vs linked clones (copy-on-write), cloud-init first boot |
| 04 | **Cluster & quorum** | Corosync quorum simulator: power off nodes, split the network, add a QDevice |
| 05 | **High availability** | Fail a node: watchdog fencing, CRM recovery, HA rules |
| 06 | **Live migration** | Pre-copy RAM rounds vs dirty rate, downtime, local-disk mirroring |
| 07 | **Bridges, VLANs & bonds** | Packet path from VM to switch; VLAN tags, bond hashing, live `/etc/network/interfaces` |
| 08 | **SDN zones & VNets** | Simple, VLAN, QinQ, VXLAN, EVPN across nodes, with header diagrams |
| 09 | **Firewall** | Rule evaluator across datacenter, security group and guest levels |
| 10 | **Storage types** | Matrix + chooser, where the bytes live, thin-provisioning overcommit |
| 11 | **ZFS** | Pool builder, disk failures, CoW snapshots, replication RPO |
| 12 | **Ceph** | Objects → PGs → CRUSH → OSDs; fail OSDs/hosts and watch recovery |
| 13 | **Backups & PBS** | vzdump modes, copy-before-write, chunk dedup, prune simulator |
| 14 | **API, users & automation** | ACL evaluator, API tokens, Terraform |
| 15 | **Proxmox + Kubernetes** | Where the Proxmox CCM and CSI plug in |

## Run it

```bash
pnpm install
pnpm dev   # http://localhost:3101
```

Stack: Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Shiki. All diagrams are hand-drawn SVG + React state.

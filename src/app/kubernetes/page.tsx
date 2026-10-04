import { Code } from "@/components/code/Code";
import { CcmDemo, CsiDemo } from "@/components/kubernetes/K8sOnProxmox";
import { Callout, Matrix, PageHeader, Section, Takeaways } from "@/components/ui";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/kubernetes");

const SISTER = "https://talos-visualized.vercel.app";
const DEEP_DIVES = [
  { href: `${SISTER}/talos-on-proxmox`, title: "Talos on Proxmox", blurb: "Building the VMs: image factory, machine configs, bootstrap." },
  { href: `${SISTER}/proxmox-ccm`, title: "Proxmox CCM", blurb: "Node initialization, providerID and topology labels in detail." },
  { href: `${SISTER}/proxmox-csi`, title: "Proxmox CSI", blurb: "StorageClasses, attach/detach and zonal volumes in detail." },
];

const TOKENS = `
# --- Cloud Controller Manager: read-only ---
pveum role add CCM -privs "VM.Audit VM.GuestAgent.Audit Sys.Audit"
pveum user add kubernetes@pve
pveum aclmod / -user kubernetes@pve -role CCM
pveum user token add kubernetes@pve ccm -privsep 0

# --- CSI plugin: may create disks and change VM disk config ---
pveum role add CSI -privs "VM.Audit VM.Config.Disk Datastore.Allocate Datastore.AllocateSpace Datastore.Audit"
pveum user add kubernetes-csi@pve
pveum aclmod / -user kubernetes-csi@pve -role CSI
pveum user token add kubernetes-csi@pve csi -privsep 0
`;

const CONFIG = `
# CSI config.yaml (the CCM uses the same format with its own token)
clusters:
  - url: https://pve1.example.com:8006/api2/json
    insecure: false
    token_id: "kubernetes-csi@pve!csi"
    token_secret: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    region: pve-dc1          # becomes topology.kubernetes.io/region
`;

const SC = `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: proxmox-local-lvm
provisioner: csi.proxmox.sinextra.dev
parameters:
  storage: local-lvm          # Proxmox storage ID
  csi.storage.k8s.io/fstype: ext4
  cache: none
  ssd: "true"
volumeBindingMode: WaitForFirstConsumer   # pick the pod's node first, then create the disk there
allowVolumeExpansion: true
reclaimPolicy: Delete
`;

const CEPH = `
# on a Proxmox node: a pool and a restricted Ceph user for Kubernetes
pveceph pool create kubernetes --application rbd
ceph auth get-or-create client.kubernetes \\
  mon 'profile rbd' osd 'profile rbd pool=kubernetes' mgr 'profile rbd pool=kubernetes'
ceph fsid                     # → clusterID for ceph-csi
ceph mon dump                 # → monitor addresses
`;

export default async function Page() {
  return (
    <>
      <PageHeader n="15" title="Proxmox + Kubernetes">
        Proxmox is a common home for Kubernetes: each Kubernetes node is a VM, and the Proxmox cluster supplies the
        machines, disks and networks. Kubernetes doesn&apos;t know that by itself. Two add-ons connect the two: a{" "}
        <b className="text-ink">Cloud Controller Manager</b> tells Kubernetes which VM and which physical host each node
        is, and a <b className="text-ink">CSI plugin</b> turns PersistentVolumeClaims into real Proxmox disks.
      </PageHeader>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        {DEEP_DIVES.map((d) => (
          <a
            key={d.href}
            href={d.href}
            target="_blank"
            rel="noreferrer"
            className="group rounded-xl border border-accent/40 bg-accent/5 p-4 transition hover:border-accent hover:bg-accent/10"
          >
            <div className="font-mono text-[10.5px] text-accent">talos-visualized ↗</div>
            <div className="mt-1 font-medium text-ink group-hover:text-accent">{d.title}</div>
            <div className="mt-1 text-[13px] leading-relaxed text-muted">{d.blurb}</div>
          </a>
        ))}
      </div>

      <Section title="VMs as Kubernetes nodes" kicker="which distribution">
        All of these run fine in Proxmox VMs. Usually a template plus cloud-init (or Talos machine configs) creates
        them, through Terraform/OpenTofu or Cluster API. Spread control-plane VMs over different Proxmox nodes, otherwise
        losing one host loses etcd quorum.
      </Section>
      <Matrix
        columns={["Talos Linux", "kubeadm", "k3s"]}
        rows={[
          { label: "OS", cells: ["immutable, API-only, no SSH", "any distro (Debian/Ubuntu)", "any distro, single binary"] },
          { label: "Provisioning", cells: ["ISO/nocloud image + machine config", "cloud-init + kubeadm init/join", "cloud-init + install script"] },
          { label: "Upgrades", cells: ["talosctl upgrade (A/B image)", "kubeadm upgrade per node", "replace binary / system-upgrade-controller"] },
          { label: "Fits", cells: ["production fleets, GitOps", "learning the parts, full control", "small clusters, homelabs, edge"] },
        ]}
      />

      <Section title="Cloud Controller Manager: who is this node?" kicker="sergelogvinov/proxmox-cloud-controller-manager">
        Kubelets started with <span className="font-mono">--cloud-provider=external</span> register with a taint and wait
        for a CCM to initialize them. The Proxmox CCM sets{" "}
        <span className="font-mono">providerID: proxmox://&lt;region&gt;/&lt;vmid&gt;</span>, the topology labels (region
        = Proxmox cluster name from its config, zone = Proxmox node hosting the VM), an instance type and the node
        addresses. Its node-lifecycle controller deletes Node objects whose VM is gone.
      </Section>
      <CcmDemo />

      <Section title="CSI: a claim becomes a disk" kicker="sergelogvinov/proxmox-csi-plugin">
        The Proxmox CSI plugin uses the Proxmox API. Its controller creates a disk on a Proxmox storage and hot-plugs it
        into the VM running the pod as a SCSI disk. A node plugin (a DaemonSet in each VM) formats and mounts it. With
        node-local storage such as local-lvm or local ZFS the disk exists on one host only, so the volume is{" "}
        <b className="text-ink">zonal</b>: the plugin reads the CCM&apos;s zone label to know where to create the disk and
        where the pod may run.
      </Section>
      <CsiDemo />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Code code={SC} lang="yaml" title="StorageClass for the Proxmox CSI plugin" />
        <div className="flex flex-col gap-4">
          <Callout tone="info" title="Why WaitForFirstConsumer matters">
            With immediate binding the disk would be created before the scheduler has chosen a node, maybe on pve1 while
            the pod later lands on pve3. Waiting for the first consumer means: choose the pod&apos;s node, then create the
            disk on that host&apos;s storage.
          </Callout>
          <Callout tone="warn" title="Zonal volumes and maintenance">
            A pod using a local-storage volume can only run on VMs in that Proxmox node&apos;s zone. Run several replicas
            spread across zones (topologySpreadConstraints) and let the application replicate the data (Postgres
            streaming, Kafka, etcd), or use shared storage.
          </Callout>
        </div>
      </div>

      <Section title="API tokens with minimal privileges" kicker="pveum">
        Give each component its own user and token, scoped to what it does. The CCM only reads VM and node information.
        The CSI plugin also allocates storage and edits VM disk configuration. Roles below follow the projects&apos;
        install docs; check them for your plugin version, since features like replication or volume migration need more
        privileges. In production, scope the ACL to the relevant pools and storages instead of <span className="font-mono">/</span>.
      </Section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Code code={TOKENS} lang="bash" title="on any Proxmox node" />
        <div className="flex flex-col gap-4">
          <Code code={CONFIG} lang="yaml" title="cloud config (Kubernetes Secret)" />
          <Callout tone="info" title="privsep">
            With <span className="font-mono">-privsep 0</span> the token has its user&apos;s privileges. With{" "}
            <span className="font-mono">-privsep 1</span> it has no privileges until you also grant an ACL to the token
            itself (<span className="font-mono">pveum aclmod / -token &apos;kubernetes-csi@pve!csi&apos; -role CSI</span>).
          </Callout>
        </div>
      </div>

      <Section title="Alternative: Ceph RBD CSI on Proxmox's Ceph" kicker="shared instead of zonal">
        If the Proxmox cluster runs Ceph, Kubernetes can use it directly with the upstream{" "}
        <span className="font-mono">ceph-csi</span> RBD driver. The VMs map RBD images over the network, so volumes are
        not tied to a host. A pod can restart on any node and Ceph replicates the data. In exchange, the Kubernetes VMs
        need a route to the Ceph public network and a Ceph key, so Kubernetes now depends directly on the storage
        cluster. Switch the CSI demo above to ceph-csi to compare.
      </Section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Code code={CEPH} lang="bash" title="prepare Proxmox Ceph for ceph-csi" />
        <Matrix
          columns={["Proxmox CSI", "ceph-csi RBD"]}
          rows={[
            { label: "Talks to", cells: ["Proxmox API (token)", "Ceph MONs/OSDs (cephx key)"] },
            { label: "Disk appears as", cells: ["SCSI disk hot-plugged by QEMU", "/dev/rbdX mapped inside the VM"] },
            { label: "Topology", cells: ["zonal for local storage", "any node"] },
            { label: "Network", cells: ["none extra", "VMs must reach Ceph public net"] },
            { label: "Needs", cells: ["CCM zone labels", "nothing from CCM"] },
          ]}
        />
      </div>

      <Takeaways
        items={[
          "The CCM tells Kubernetes where each node is: providerID proxmox://<cluster>/<vmid>, region = Proxmox cluster, zone = Proxmox host. The scheduler, the CSI plugin and your topology spread rules all rely on these labels.",
          "The Proxmox CSI plugin turns a PVC into a real VM disk through the API and hot-plugs it into the right VM. With local storage that volume is zonal, so plan replicas per Proxmox host.",
          "Use separate API tokens with minimal roles for CCM (audit only) and CSI (disk + datastore). Choose ceph-csi when pods must move freely between hosts and the VMs can reach Ceph.",
        ]}
      />
    </>
  );
}

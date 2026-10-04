import { Code } from "@/components/code/Code";
import { BytesPath } from "@/components/storage/BytesPath";
import { StorageChooser } from "@/components/storage/StorageChooser";
import { ThinPool } from "@/components/storage/ThinPool";
import { Callout, PageHeader, Panel, Section, Takeaways } from "@/components/ui";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/storage");

const storageCfg = `
# /etc/pve/storage.cfg  (cluster-wide: pmxcfs replicates it to every node)
dir: local
	path /var/lib/vz
	content iso,vztmpl,backup

lvmthin: local-lvm
	thinpool data
	vgname pve
	content rootdir,images

# a ZFS install creates this instead of local-lvm:
# zfspool: local-zfs
# 	pool rpool/data
# 	sparse 1
# 	content images,rootdir

nfs: nas
	server 10.0.0.20
	export /export/pve
	path /mnt/pve/nas
	content iso,backup,snippets
	prune-backups keep-daily=7,keep-weekly=4

rbd: ceph-vm
	pool vm-pool
	content images,rootdir
	krbd 0

pbs: pbs
	server 10.0.0.30
	datastore store1
	username backup@pbs
	fingerprint 4b:9e:…:c1
	content backup
`;

const pvesm = `
# list storages and their usage on this node
pvesm status

# what is on a storage (volume ids)
pvesm list local-lvm

# add storages from the CLI (same as Datacenter → Storage → Add)
pvesm add nfs nas --server 10.0.0.20 --export /export/pve --content iso,backup
pvesm add lvm san-lvm --vgname vg-san --shared 1 --content images

# volume id → real path on this node
pvesm path local-lvm:vm-100-disk-0      # /dev/pve/vm-100-disk-0

# restrict a local storage to the nodes that actually have it
pvesm set local-zfs --nodes pve1,pve2
`;

const thin = `
# thin pool usage: watch Data% and Meta%
lvs -o lv_name,lv_size,data_percent,metadata_percent pve
#  LV            LSize   Data%  Meta%
#  data          <1.0t   63.12  2.41
#  vm-100-disk-0 100.00g 54.80
#  vm-101-disk-0 100.00g 32.17

# let lvm grow the pool automatically from free VG space (lvm.conf)
#   thin_pool_autoextend_threshold = 80
#   thin_pool_autoextend_percent   = 20

# give freed guest blocks back: discard on the disk, trim in the guest
qm set 100 --scsi0 local-lvm:vm-100-disk-0,discard=on,ssd=1
# inside the guest:  fstrim -av   (or enable fstrim.timer)
`;

export default function Page() {
  return (
    <>
      <PageHeader n="10" title="Storage types">
        Proxmox does not have one storage engine; it has a <em>plugin</em> per backend, all described in one file,{" "}
        <code className="text-ink">/etc/pve/storage.cfg</code>. Each entry gets an id (like <code className="text-ink">local-lvm</code>), a type, and a
        list of <em>content types</em> it may hold. A VM disk is then just <code className="text-ink">storage-id:volume-name</code>, and the plugin
        knows how to create, snapshot, clone, migrate and delete it. Which plugin you pick decides what those operations cost.
      </PageHeader>

      <Panel title="Pick your requirements · see what fits">
        <StorageChooser />
      </Panel>

      <Section title="Content types: what a storage is allowed to hold" kicker="the plugin model">
        The same NFS share can hold ISOs and backups but not VM disks, simply because <code>images</code> is missing from its content list. PVE uses
        the list to decide which storages to offer in each dialog, and the directory layout follows it: <code>images/</code>,{" "}
        <code>template/iso/</code>, <code>template/cache/</code> (CT templates), <code>dump/</code> (backups), <code>snippets/</code>,{" "}
        <code>import/</code>. Block storages (LVM, RBD, zvols) can only hold <code>images</code> and <code>rootdir</code>, because there is no filesystem
        to put an ISO on.
      </Section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Code code={storageCfg} lang="ini" title="/etc/pve/storage.cfg — a typical small cluster" />
        <div className="space-y-4">
          <Callout title="The default install">
            The installer creates <code>local</code> (a directory at <code>/var/lib/vz</code> for ISOs, templates and backups) plus either{" "}
            <code>local-lvm</code> (an LVM-thin pool <code>pve/data</code>, when you install on ext4/xfs) or <code>local-zfs</code> (the dataset{" "}
            <code>rpool/data</code>, when you install on ZFS). Guests go on the second one.
          </Callout>
          <Callout tone="warn" title="Local is local">
            <code>storage.cfg</code> is cluster-wide, but <code>local-lvm</code> on node A and <code>local-lvm</code> on node B are two different
            pools with the same name. Migrating a VM on local storage copies its disks over the network; HA cannot restart it elsewhere unless you
            replicate (ZFS) or use shared storage.
          </Callout>
          <Callout tone="info" title="New in 9.x: snapshots on thick LVM">
            Shared thick LVM on a SAN historically had no snapshots. PVE 9 adds <em>snapshots as volume chains</em> (technology preview): with{" "}
            <code>snapshot-as-volume-chain 1</code>, disks are qcow2-formatted on top of the LV and each snapshot becomes a new layer in the chain.
            The same mechanism is available for directory, NFS and CIFS storages.
          </Callout>
        </div>
      </div>

      <Section title="Where do the bytes actually live?" kicker="volume id → device → media">
        Follow one VM disk from what the guest sees down to the physical media. File-level storages end in a file on some filesystem; block-level
        storages end in a block device (or, for RBD and ZFS over iSCSI, in a network protocol QEMU speaks itself).
      </Section>
      <Panel title="Trace a VM disk">
        <BytesPath />
      </Panel>

      <Section title="Thin provisioning: promises versus disk" kicker="LVM-thin, sparse zvols, RBD, qcow2">
        Thin storages allocate a block the first time a guest writes it. That makes snapshots cheap and lets you hand out more virtual disk than
        you own. It also means the pool can fill up while every guest still sees free space. Push the sliders until it breaks.
      </Section>
      <Panel title="Overcommit a 1000 GiB thin pool">
        <ThinPool />
      </Panel>

      <Section title="The CLI" kicker="pvesm, lvs" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Code code={pvesm} title="pvesm — the storage manager" />
        <Code code={thin} title="keeping a thin pool healthy" />
      </div>

      <Takeaways
        items={[
          <span key="t1">
            A storage is a plugin + an id + allowed content types in <code>/etc/pve/storage.cfg</code>. Volume ids like{" "}
            <code>local-lvm:vm-100-disk-0</code> are what VM configs reference, so moving a disk is a plugin operation, not a file copy you do by hand.
          </span>,
          <span key="t2">
            Features come from the backend: shared storage (NFS, RBD, SAN LVM) makes migration and HA cheap; LVM-thin, ZFS and RBD give fast snapshots
            and linked clones; file storages get them from qcow2.
          </span>,
          <span key="t3">
            Thin provisioning is a promise, not capacity. Monitor real usage (<code>lvs</code>, <code>zfs list</code>, <code>ceph df</code>), enable
            discard, and grow the pool before it fills, because a full thin pool pauses every VM on it at once.
          </span>,
        ]}
      />
    </>
  );
}

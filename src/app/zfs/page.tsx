import { Code } from "@/components/code/Code";
import { ArcMemory } from "@/components/zfs/ArcMemory";
import { CowSnapshots } from "@/components/zfs/CowSnapshots";
import { PoolBuilder } from "@/components/zfs/PoolBuilder";
import { Replication } from "@/components/zfs/Replication";
import { Callout, Matrix, PageHeader, Panel, Section, Takeaways } from "@/components/ui";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/zfs");

const create = `
# striped mirrors (RAID10) from four NVMe drives, 4K sectors
zpool create -o ashift=12 tank \\
  mirror /dev/disk/by-id/nvme-A /dev/disk/by-id/nvme-B \\
  mirror /dev/disk/by-id/nvme-C /dev/disk/by-id/nvme-D

# make it a PVE storage (thin zvols, VMs + CTs)
pvesm add zfspool tank-vm --pool tank --content images,rootdir --sparse 1

# or let the GUI/API do both:  Node → Disks → ZFS → Create
pvesh create /nodes/pve1/disks/zfs --name tank --raidlevel raid10 \\
  --devices /dev/nvme0n1,/dev/nvme1n1,/dev/nvme2n1,/dev/nvme3n1 \\
  --ashift 12 --compression lz4 --add_storage 1
`;

const status = `
$ zpool status tank
  pool: tank
 state: DEGRADED
status: One or more devices could not be used because the label is missing or
        invalid.  Sufficient replicas exist for the pool to continue
        functioning in a degraded state.
action: Replace the device using 'zpool replace'.
config:
        NAME          STATE     READ WRITE CKSUM
        tank          DEGRADED     0     0     0
          mirror-0    DEGRADED     0     0     0
            nvme-A    ONLINE       0     0     0
            nvme-B    UNAVAIL      0     0     0
          mirror-1    ONLINE       0     0     0
            nvme-C    ONLINE       0     0     0
            nvme-D    ONLINE       0     0     0

$ zpool replace tank nvme-B /dev/disk/by-id/nvme-E   # resilver starts
`;

const datasets = `
$ zfs list -o name,used,refer,volsize,volblocksize,compressratio -r rpool/data
NAME                              USED  REFER  VOLSIZE  VOLBLOCK  RATIO
rpool/data                       61.2G    96K        -         -  1.52x
rpool/data/subvol-101-disk-0     1.31G  1.31G        -         -  2.03x
rpool/data/vm-100-disk-0         38.4G  31.0G      64G       16K  1.41x

# snapshots: PVE wraps them (qm snapshot also saves the VM config / RAM state)
qm snapshot 100 before-upgrade
zfs list -t snapshot -o name,used,refer rpool/data/vm-100-disk-0
# rpool/data/vm-100-disk-0@before-upgrade   7.4G  30.9G   ← USED = blocks only it still holds

# the raw ZFS equivalent
zfs snapshot rpool/data/vm-100-disk-0@manual
zfs rollback rpool/data/vm-100-disk-0@manual
`;

const pvesr = `
# replicate VM 100 to pve2 every 15 minutes, max 50 MB/s
pvesr create-local-job 100-0 pve2 --schedule "*/15" --rate 50

pvesr list                     # jobs
pvesr status                   # last sync, duration, next run, fail count
pvesr schedule-now 100-0       # run it as soon as possible

# under the hood, per disk, per run:
#   zfs snapshot rpool/data/vm-100-disk-0@__replicate_100-0_<epoch>__
#   zfs send -i @<previous> @<new> | ssh pve2 zfs recv ...
#   then the previous replication snapshot is removed on both sides
`;

export default function Page() {
  return (
    <>
      <PageHeader n="11" title="ZFS">
        ZFS is a volume manager and a filesystem in one: it pools disks into <em>vdevs</em>, checksums every block, never overwrites live data, and
        turns that into snapshots, clones, compression and replication for free. Proxmox ships it in the installer and uses it as the{" "}
        <code className="text-ink">zfspool</code> storage type. Getting the pool layout right is the one decision you cannot easily undo.
      </PageHeader>

      <Panel title="Pool builder · capacity, redundancy, IOPS">
        <PoolBuilder />
      </Panel>

      <Section title="Why mirrors are the default advice for VM storage" kicker="vdevs are the unit of performance">
        A pool stripes across its top-level vdevs, and each RAIDZ vdev behaves roughly like a single disk for small random I/O, because every block
        is spread over all its members with parity. VM disks are mostly small random reads and writes. So eight disks as one RAIDZ2 give you about
        one disk of random IOPS, while the same eight disks as four mirrors give you about four for writes and up to eight for reads.
      </Section>
      <div className="grid gap-4 md:grid-cols-3">
        <Callout tone="ok" title="Mirrors (RAID10)">
          Best random IOPS, fastest and least stressful resilver (copy from the partner, no parity math), and you can grow the pool two disks at a
          time. Costs 50% of raw capacity.
        </Callout>
        <Callout tone="warn" title="RAIDZ">
          Great capacity for bulk data, backups and ISO stores. For VM zvols, small blocks pay padding: a 16K block on a 5-disk RAIDZ1 with 4K
          sectors takes 6 sectors, not 5, so the advertised efficiency is not what you get.
        </Callout>
        <Callout tone="info" title="dRAID">
          Distributed RAID with spare capacity spread over every disk, so a rebuild writes to all disks in parallel. Built for big pools (dozens of
          disks), with a fixed stripe width that makes it a poor fit for small VM blocks.
        </Callout>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code code={create} title="create a pool and register it as storage" />
        <Code code={status} title="a degraded pool" lang="text" />
      </div>

      <Section title="Copy-on-write: why snapshots are instant and free (at first)" kicker="block pointers, txgs, uberblock">
        ZFS writes changes into free space and then updates the pointers above them, all the way to the uberblock, once per transaction group
        (txg). A snapshot simply keeps an old root alive. It costs nothing when taken; it grows as the live data diverges, because every overwritten
        block it still references cannot be freed.
      </Section>
      <Panel title="Take a snapshot, then overwrite blocks">
        <CowSnapshots />
      </Panel>

      <Section title="zvols for VMs, datasets for containers" kicker="what local-zfs actually creates" />
      <Matrix
        columns={["zvol (VM disk)", "dataset / subvol (container)"]}
        rows={[
          { label: "name", cells: [<code key="a">rpool/data/vm-100-disk-0</code>, <code key="b">rpool/data/subvol-101-disk-0</code>] },
          {
            label: "what it is",
            cells: ["a virtual block device at /dev/zvol/…, the guest puts its own filesystem on it", "a ZFS filesystem mounted on the host, the CT sees its files directly"],
          },
          {
            label: "block size",
            cells: [
              "volblocksize, fixed at creation: 16K default (OpenZFS 2.2+). Larger = better compression and less RAIDZ padding, worse for small random writes",
              "recordsize, a maximum (128K default): small files use small blocks",
            ],
          },
          { label: "size limit", cells: ["volsize (the virtual disk size)", "refquota (the CT disk size)"] },
          { label: "thin?", cells: ["only with sparse 1 on the storage (no refreservation)", "always: quota, not a reservation"] },
          { label: "compression", cells: ["lz4 inherited from the pool: cheap, usually a net speedup", "same, and it compresses per file record"] },
        ]}
      />

      <Section title="ARC, and the extra vdev classes" kicker="memory and devices">
        ZFS caches reads in RAM (the ARC) and can use extra devices for specific jobs. None of the extra devices replace redundancy, and two of them
        are often misunderstood.
      </Section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel title="Size the ARC">
          <ArcMemory />
        </Panel>
        <div className="space-y-3">
          <Callout title="SLOG (log vdev)">
            Holds the ZFS intent log for <em>synchronous</em> writes only (databases, NFS, VMs with sync semantics). It makes fsync fast; it does
            nothing for async writes and is not a write cache. Needs power-loss protection; mirror it.
          </Callout>
          <Callout title="L2ARC (cache vdev)">
            A second-level read cache on SSD. Its index lives in RAM, so it competes with the ARC. Add RAM first; L2ARC only helps when the working
            set is bigger than RAM but fits the SSD. Losing it is harmless.
          </Callout>
          <Callout tone="warn" title="special vdev">
            Stores metadata (and optionally small blocks) on fast SSDs in front of HDDs. It is part of the pool: lose it and you lose the pool, so
            give it the same redundancy as the data vdevs.
          </Callout>
        </div>
      </div>

      <Section title="Storage replication: ZFS's answer to shared storage" kicker="pvesr · asynchronous">
        Local ZFS is not shared, so a node failure would strand its VMs. <code>pvesr</code> periodically sends incremental snapshots of a
        guest&apos;s disks to another node, so migration only transfers the latest delta and HA can restart the guest there. The price is the
        interval: anything written since the last successful run is lost on a crash. Let it run, then pull the plug.
      </Section>
      <Panel title="Replicate VM 100 from pve1 to pve2">
        <Replication />
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code code={datasets} title="datasets, zvols, snapshots" />
        <Code code={pvesr} title="pvesr — storage replication" />
      </div>

      <Takeaways
        items={[
          <span key="t1">
            Pool layout decides random IOPS: each vdev is roughly one disk&apos;s worth. For VM storage, use striped mirrors; use RAIDZ for capacity
            workloads like backups. Losing any top-level vdev loses the pool.
          </span>,
          <span key="t2">
            Copy-on-write makes snapshots instant, but a snapshot pins every block overwritten after it. Old snapshots quietly eat space; watch the
            USED column and prune them.
          </span>,
          <span key="t3">
            ZFS replication gives local disks a failover story, but it is asynchronous: RPO equals the schedule. Zero-loss failover needs shared
            storage such as Ceph.
          </span>,
        ]}
      />
    </>
  );
}

import { Fragment } from "react";
import { Callout, Matrix, PageHeader, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { VzdumpModes } from "@/components/backup/VzdumpModes";
import { CopyBeforeWrite } from "@/components/backup/CopyBeforeWrite";
import { DedupDemo } from "@/components/backup/DedupDemo";
import { ChunkingDemo } from "@/components/backup/ChunkingDemo";
import { PruneSim } from "@/components/backup/PruneSim";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/backup");

const pve = `# attach a PBS datastore as storage (client-side encryption key generated on the PVE side)
pvesm add pbs pbs1 --server 10.0.0.5 --datastore store1 \\
    --username backup@pbs --password '...' \\
    --fingerprint 'ab:cd:...:ef' --encryption-key autogen

# one-off backup, live, with fleecing on fast local storage
vzdump 100 --mode snapshot --storage pbs1 \\
    --fleecing enabled=1,storage=local-lvm --notes-template '{{guestname}}'

# local file backup instead (one .vma.zst / .tar.zst per run, no dedup)
vzdump 200 --mode snapshot --storage local --compress zstd

pvesm list pbs1 --vmid 100     # what's there
qmrestore pbs1:backup/vm/100/2026-10-03T21:00:02Z 100 --storage ceph-vm`;

const jobs = `# /etc/pve/jobs.cfg  (Datacenter → Backup)
vzdump: backup-nightly
	schedule 21:00
	all 1
	mode snapshot
	storage pbs1
	fleecing enabled=1,storage=local-lvm
	notes-template {{guestname}}
	prune-backups keep-last=3,keep-daily=7,keep-weekly=4,keep-monthly=6
	enabled 1`;

const client = `# file-level backup of any Linux host (dynamic chunks, .pxar)
export PBS_REPOSITORY='backup@pbs@10.0.0.5:store1'
proxmox-backup-client backup root.pxar:/ etc.pxar:/etc --keyfile ~/.pbs.key
proxmox-backup-client snapshot list
proxmox-backup-client prune host/web01 --keep-daily 7 --keep-weekly 4 --dry-run

# on the PBS server
proxmox-backup-manager garbage-collection start store1
proxmox-backup-manager verify store1
proxmox-backup-manager remote create offsite --host pbs2.example.com \\
    --auth-id sync@pbs --password '...' --fingerprint '...'
proxmox-backup-manager sync-job create offsite-pull --store store1 \\
    --remote offsite --remote-store store1 --schedule 'daily'`;

const layout = `/mnt/datastore/store1/
├── .chunks/                 # 65536 prefix dirs: 0000 … ffff
│   ├── 3fa1/3fa1c9…e2       # one file per unique chunk, named by SHA-256
│   └── …
├── vm/100/2026-10-03T21:00:02Z/
│   ├── index.json.blob      # manifest (signed if encrypted)
│   ├── qemu-server.conf.blob
│   └── drive-scsi0.img.fidx # fixed index: list of chunk digests
└── ct/200/2026-10-03T21:05:40Z/
    └── root.pxar.didx       # dynamic index: digests + offsets`;

export default function Page() {
  return (
    <>
      <PageHeader n="13" title="Backups & PBS">
        Proxmox has two layers of backup. <code className="font-mono">vzdump</code> decides <b className="text-ink">how to
        read a consistent image</b> of a guest without stopping it for long. <b className="text-ink">Proxmox Backup Server</b>{" "}
        decides <b className="text-ink">how to store it</b>: split into chunks, named by their SHA-256, stored once no matter
        how many backups refer to them. Together they turn nightly full backups into &ldquo;read what changed, send what&apos;s
        new&rdquo;.
      </PageHeader>

      <VzdumpModes />

      <Section title="How snapshot mode works with no storage snapshot" kicker="copy-before-write">
        For VMs, Proxmox doesn&apos;t need ZFS or LVM snapshots: the backup runs inside QEMU itself. When the job starts, the
        backup must contain the disk exactly as it was at that instant. QEMU reads the disk front to back; if the guest tries to
        overwrite a block the job hasn&apos;t read yet, QEMU first copies the <i>old</i> block to the backup and only then lets
        the write through. The guest pays with write latency, which hurts when the target is slow or far away.{" "}
        <b className="text-ink">Fleecing</b> parks those old blocks on fast local storage instead, decoupling guest I/O from backup
        speed.
      </Section>

      <CopyBeforeWrite />

      <Section title="Chunks: the unit of everything in PBS" kicker="proxmox backup server">
        A VM disk is cut into fixed 4&nbsp;MiB chunks. Each chunk is hashed with SHA-256, optionally compressed (zstd) and
        encrypted, and stored as a file named by its digest. A backup snapshot is just an <i>index</i>: an ordered list of
        digests. Two backups that share a chunk share one file. The client skips uploading chunks the previous snapshot of the
        same guest already has, and for running VMs QEMU&apos;s <b className="text-ink">dirty bitmap</b> tells it which
        chunks were even written since the last backup, so it doesn&apos;t have to read the rest. Change some chunks, back up,
        prune, run GC:
      </Section>

      <DedupDemo />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Callout tone="info" title="Dirty bitmap = incremental reads">
          QEMU keeps a bitmap of changed blocks in memory per disk. It survives live migration, but not a VM stop/start, and is
          dropped if the last backup on the server is gone or the encryption key changed. Then the next run reads everything
          again but still uploads only new chunks.
        </Callout>
        <Callout tone="info" title="GC: mark and sweep with atime">
          Pruning only deletes index files. Garbage collection then (1) walks every index and touches every chunk it references
          (updating its atime), (2) deletes chunks whose atime is older than the cutoff: 24&nbsp;h 5&nbsp;min before GC started,
          or the start of the oldest running backup if that is earlier. That grace window protects chunks a running backup just
          reused but hasn&apos;t indexed yet.
        </Callout>
        <Callout tone="warn" title="Encryption happens on the client">
          With a key, chunks are encrypted with AES-256-GCM before leaving the node; PBS stores ciphertext and never sees the key.
          Keep a copy of the key (paperkey, or a master key) off the cluster: without it the backups are noise. Dedup then only
          works between backups using the same key.
        </Callout>
      </div>

      <Section title="Fixed chunks for disks, dynamic chunks for files" kicker="chunking" />
      <ChunkingDemo />

      <Section title="Retention: which backups survive" kicker="prune">
        Prune options are evaluated in order: last, hourly, daily, weekly, monthly, yearly. Each keeps the newest backup of each
        of its N most recent periods, skipping periods a previous option already covered. So keep-weekly=4 means &ldquo;four more
        weeks beyond those already kept&rdquo;, not &ldquo;the last four weeks&rdquo;. Change the numbers and hover cells.
      </Section>
      <PruneSim />

      <Section title="Trusting the backups" kicker="verify · sync · offsite" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Callout tone="ok" title="Verify jobs">
          Re-read every chunk of selected snapshots and check it against its digest. Corrupt chunks are renamed to{" "}
          <code className="font-mono">.bad</code> and the snapshot is flagged, so the next backup re-uploads the data. Schedule it:
          bit rot is silent until restore day.
        </Callout>
        <Callout tone="ok" title="Sync jobs & remotes">
          Copy snapshots to (push) or from (pull) another PBS. Only missing chunks travel, so an offsite copy over a WAN is cheap.
          With encrypted backups, the offsite PBS holds ciphertext only.
        </Callout>
        <Callout tone="info" title="Replication is not backup">
          <code className="font-mono">pvesr</code> sends incremental ZFS snapshots of local disks to another node every few
          minutes so HA or migration can start there with little data loss. It mirrors mistakes too: a deleted file or
          ransomware arrives on the replica at the next sync. Use it next to backups, not instead.
        </Callout>
      </div>

      <div className="mt-4">
        <Matrix
          columns={["vzdump → local / NFS", "vzdump → PBS", "pvesr replication"]}
          rows={[
            { label: "unit", cells: [".vma.zst / .tar.zst file per run", "chunks + index per snapshot", "ZFS snapshot on another node"] },
            { label: "incremental", cells: ["no, full every time", "yes (dirty bitmap + dedup)", "yes (zfs send -i)"] },
            { label: "history", cells: ["per retention", "per retention, cheap", "only latest (+ few snaps)"] },
            { label: "survives a bad delete", cells: ["yes", "yes", "no, replicated next sync"] },
            { label: "restore speed", cells: ["full read", "full read, or live-restore / single file", "instant: start from replica"] },
          ]}
        />
      </div>

      <Section title="Commands and files" kicker="cli" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Code code={pve} title="on Proxmox VE" />
        <div className="space-y-4">
          <Code code={jobs} lang="text" title="scheduled job" />
          <Code code={layout} lang="text" title="what a PBS datastore looks like" />
        </div>
      </div>
      <div className="mt-4">
        <Code code={client} title="proxmox-backup-client / proxmox-backup-manager" />
      </div>

      <Takeaways
        items={[
          <Fragment key="1">Use snapshot mode for VMs: QEMU&apos;s copy-before-write gives a point-in-time image with no downtime. Add the guest agent for filesystem consistency and fleecing when the backup target is slow.</Fragment>,
          <Fragment key="2">PBS stores chunks, not files. Every backup is logically full but physically incremental, so you can keep long histories cheaply and restore any point without a chain.</Fragment>,
          <Fragment key="3">Prune deletes indexes; GC frees space later. Verify and sync jobs are what make a backup trustworthy: an unverified, single-copy backup is a hope, not a plan.</Fragment>,
        ]}
      />
    </>
  );
}

export type Tri = "yes" | "no" | "partial";

export type ContentType = "images" | "rootdir" | "iso" | "vztmpl" | "backup" | "snippets" | "import";

export const CONTENT_TYPES: { id: ContentType; label: string; what: string }[] = [
  { id: "images", label: "images", what: "VM disk images" },
  { id: "rootdir", label: "rootdir", what: "container root filesystems / volumes" },
  { id: "iso", label: "iso", what: "installer ISO images" },
  { id: "vztmpl", label: "vztmpl", what: "container templates (.tar.zst)" },
  { id: "backup", label: "backup", what: "vzdump backups" },
  { id: "snippets", label: "snippets", what: "hookscripts, cloud-init user-data" },
  { id: "import", label: "import", what: "OVA/OVF and disk images to import" },
];

export type Layer = { label: string; value: string; note?: string };

export type StorageKind = {
  id: string;
  name: string;
  /** storage.cfg type keyword */
  type: string;
  level: "file" | "block" | "both";
  shared: Tri;
  sharedNote?: string;
  snapshots: Tri;
  snapNote?: string;
  thin: Tri;
  clones: Tri;
  formats: string[];
  content: ContentType[];
  preview?: boolean;
  blurb: string;
  /** volume id as it appears in a VM config */
  volid: string;
  /** "where do the bytes live": from guest down to the media */
  chain: Layer[];
};

const ALL: ContentType[] = ["images", "rootdir", "iso", "vztmpl", "backup", "snippets", "import"];

export const STORAGES: StorageKind[] = [
  {
    id: "dir",
    name: "Directory",
    type: "dir",
    level: "file",
    shared: "partial",
    sharedNote: "only if you mount a shared FS there yourself and set shared 1",
    snapshots: "partial",
    snapNote: "with qcow2 (and volume chains, preview in 9.x)",
    thin: "yes",
    clones: "partial",
    formats: ["raw", "qcow2", "vmdk", "subvol"],
    content: ALL,
    blurb: "Any mounted filesystem path. The default local storage (/var/lib/vz) is one. Simple and universal; features come from the qcow2 file format, not the storage.",
    volid: "local:100/vm-100-disk-0.qcow2",
    chain: [
      { label: "storage plugin", value: "dir: local  path /var/lib/vz" },
      { label: "file", value: "/var/lib/vz/images/100/vm-100-disk-0.qcow2", note: "qcow2 grows as the guest writes; internal snapshots live inside the file" },
      { label: "filesystem", value: "ext4 / xfs on LV pve/root" },
      { label: "media", value: "/dev/sda3 (local disk)" },
    ],
  },
  {
    id: "lvm",
    name: "LVM (thick)",
    type: "lvm",
    level: "block",
    shared: "partial",
    sharedNote: "yes when the VG sits on a shared iSCSI / FC LUN (set shared 1)",
    snapshots: "partial",
    snapNote: "classic: no. PVE 9 adds snapshots as volume chains (qcow2 on LV), technology preview",
    thin: "no",
    clones: "no",
    formats: ["raw", "qcow2*"],
    content: ["images", "rootdir"],
    blurb: "One logical volume per disk, fully allocated up front. Boring, fast and safe, and the classic way to share a SAN LUN between nodes.",
    volid: "san-lvm:vm-100-disk-0",
    chain: [
      { label: "storage plugin", value: "lvm: san-lvm  vgname vg-san  shared 1" },
      { label: "block device", value: "/dev/vg-san/vm-100-disk-0", note: "a linear LV: every extent is allocated at creation" },
      { label: "volume group", value: "VG vg-san" },
      { label: "media", value: "PV /dev/mapper/mpatha (multipathed iSCSI/FC LUN, seen by every node)" },
    ],
  },
  {
    id: "lvmthin",
    name: "LVM-thin",
    type: "lvmthin",
    level: "block",
    shared: "no",
    snapshots: "yes",
    thin: "yes",
    clones: "yes",
    formats: ["raw"],
    content: ["images", "rootdir"],
    blurb: "Thin LVs carved from a thin pool. Blocks are allocated on first write, snapshots are cheap. The default local-lvm on ext4/xfs installs.",
    volid: "local-lvm:vm-100-disk-0",
    chain: [
      { label: "storage plugin", value: "lvmthin: local-lvm  vgname pve  thinpool data" },
      { label: "block device", value: "/dev/pve/vm-100-disk-0", note: "thin LV: 32 GiB virtual, only written chunks are backed" },
      { label: "thin pool", value: "pve/data (data LV + metadata LV, dm-thin)" },
      { label: "media", value: "VG pve on PV /dev/sda3" },
    ],
  },
  {
    id: "zfspool",
    name: "ZFS (local)",
    type: "zfspool",
    level: "both",
    shared: "no",
    snapshots: "yes",
    thin: "yes",
    clones: "yes",
    formats: ["raw (zvol)", "subvol"],
    content: ["images", "rootdir"],
    blurb: "VM disks are zvols (block), container volumes are datasets (subvol). Checksums, compression, snapshots and replication built in. local-zfs on ZFS installs.",
    volid: "local-zfs:vm-100-disk-0",
    chain: [
      { label: "storage plugin", value: "zfspool: local-zfs  pool rpool/data  sparse 1" },
      { label: "block device", value: "/dev/zvol/rpool/data/vm-100-disk-0" },
      { label: "zvol", value: "rpool/data/vm-100-disk-0 (volblocksize 16k)", note: "containers get rpool/data/subvol-101-disk-0, a mounted dataset" },
      { label: "media", value: "pool rpool: mirror-0 (sda3, sdb3)" },
    ],
  },
  {
    id: "zfs",
    name: "ZFS over iSCSI",
    type: "zfs",
    level: "block",
    shared: "yes",
    snapshots: "yes",
    thin: "yes",
    clones: "yes",
    formats: ["raw"],
    content: ["images"],
    blurb: "PVE SSHes into a ZFS box to create zvols and exports each one as an iSCSI LUN (LIO, istgt, IET, comstar). Shared and snapshot-capable.",
    volid: "zfs-san:vm-100-disk-0",
    chain: [
      { label: "storage plugin", value: "zfs: zfs-san  portal 10.0.0.50  pool tank  iscsiprovider LIO" },
      { label: "QEMU", value: "iscsi://10.0.0.50/iqn.2003-01.org.linux-iscsi.san:pve/1", note: "QEMU talks iSCSI itself (libiscsi), no host block device" },
      { label: "remote zvol", value: "tank/vm-100-disk-0 (created over SSH)" },
      { label: "media", value: "pool tank on the storage server" },
    ],
  },
  {
    id: "nfs",
    name: "NFS",
    type: "nfs",
    level: "file",
    shared: "yes",
    snapshots: "partial",
    snapNote: "with qcow2 (and volume chains, preview in 9.x)",
    thin: "yes",
    clones: "partial",
    formats: ["raw", "qcow2", "vmdk"],
    content: ALL,
    blurb: "A directory storage that PVE mounts for you on every node. Shared, so live migration does not copy disks. Snapshots via qcow2.",
    volid: "nas:100/vm-100-disk-0.qcow2",
    chain: [
      { label: "storage plugin", value: "nfs: nas  server 10.0.0.20  export /export/pve" },
      { label: "file", value: "/mnt/pve/nas/images/100/vm-100-disk-0.qcow2" },
      { label: "mount", value: "10.0.0.20:/export/pve on /mnt/pve/nas (every node)" },
      { label: "media", value: "the NAS's own filesystem and disks" },
    ],
  },
  {
    id: "cifs",
    name: "CIFS / SMB",
    type: "cifs",
    level: "file",
    shared: "yes",
    snapshots: "partial",
    snapNote: "with qcow2 (and volume chains, preview in 9.x)",
    thin: "yes",
    clones: "partial",
    formats: ["raw", "qcow2", "vmdk"],
    content: ALL,
    blurb: "Like NFS but over SMB. Handy for Windows file servers and NAS boxes; most often used for ISOs and backups.",
    volid: "smb:100/vm-100-disk-0.qcow2",
    chain: [
      { label: "storage plugin", value: "cifs: smb  server 10.0.0.21  share pve" },
      { label: "file", value: "/mnt/pve/smb/images/100/vm-100-disk-0.qcow2" },
      { label: "mount", value: "//10.0.0.21/pve on /mnt/pve/smb" },
      { label: "media", value: "the file server's disks" },
    ],
  },
  {
    id: "iscsi",
    name: "iSCSI (+ LVM)",
    type: "iscsi",
    level: "block",
    shared: "yes",
    snapshots: "no",
    thin: "no",
    clones: "no",
    formats: ["raw"],
    content: ["images"],
    blurb: "Raw LUNs from a SAN. A LUN is one disk, managed on the SAN, so the usual pattern is: iSCSI storage as the transport, an LVM VG on top for per-VM volumes.",
    volid: "san:0.0.1.scsi-36001405a1b2c3d4e5f60000000000001",
    chain: [
      { label: "storage plugin", value: "iscsi: san  portal 10.0.0.40  target iqn.2003-01...:pve" },
      { label: "block device", value: "/dev/disk/by-id/scsi-36001405a1b2…", note: "the whole LUN is the VM disk; put LVM on it to slice it up" },
      { label: "session", value: "open-iscsi session from every node" },
      { label: "media", value: "LUN 1 on the SAN array" },
    ],
  },
  {
    id: "rbd",
    name: "Ceph RBD",
    type: "rbd",
    level: "block",
    shared: "yes",
    snapshots: "yes",
    thin: "yes",
    clones: "yes",
    formats: ["raw"],
    content: ["images", "rootdir"],
    blurb: "Distributed block devices striped over many OSDs, replicated across hosts. Shared, thin, snapshots and clones. The hyperconverged default.",
    volid: "ceph-vm:vm-100-disk-0",
    chain: [
      { label: "storage plugin", value: "rbd: ceph-vm  pool vm-pool  (krbd 0)" },
      { label: "QEMU", value: "librbd → rbd:vm-pool/vm-100-disk-0", note: "no host block device unless krbd 1 (containers always use krbd)" },
      { label: "RADOS objects", value: "rbd_data.<id>.0000000000000000 … (4 MiB each)" },
      { label: "media", value: "PGs → OSDs on 3+ hosts, 3 copies each" },
    ],
  },
  {
    id: "cephfs",
    name: "CephFS",
    type: "cephfs",
    level: "file",
    shared: "yes",
    snapshots: "yes",
    thin: "yes",
    clones: "no",
    formats: ["files only"],
    content: ["iso", "vztmpl", "backup", "snippets", "import"],
    blurb: "A POSIX filesystem on the same Ceph cluster. Perfect for ISOs, templates and snippets shared by all nodes; not for VM disks (use RBD).",
    volid: "cephfs:iso/debian-13.1.0-amd64-netinst.iso",
    chain: [
      { label: "storage plugin", value: "cephfs: cephfs  path /mnt/pve/cephfs" },
      { label: "file", value: "/mnt/pve/cephfs/template/iso/debian-13.1.0-amd64-netinst.iso", note: "VM disks are not allowed here" },
      { label: "metadata", value: "MDS daemon + cephfs_metadata pool" },
      { label: "media", value: "cephfs_data pool → PGs → OSDs" },
    ],
  },
  {
    id: "pbs",
    name: "Proxmox Backup Server",
    type: "pbs",
    level: "both",
    shared: "yes",
    snapshots: "no",
    snapNote: "n/a: it stores backups, which are themselves point-in-time",
    thin: "yes",
    clones: "no",
    formats: ["chunked, deduplicated"],
    content: ["backup"],
    blurb: "Not a place to run guests: a backup target. Data is split into chunks, deduplicated by SHA-256 across all backups, optionally encrypted client-side.",
    volid: "pbs:backup/vm/100/2026-10-04T02:00:00Z",
    chain: [
      { label: "storage plugin", value: "pbs: pbs  server 10.0.0.30  datastore store1" },
      { label: "index", value: "vm/100/2026-10-04T02:00:00Z/drive-scsi0.img.fidx", note: "fixed-size index: one digest per 4 MiB chunk" },
      { label: "chunk store", value: "/mnt/datastore/store1/.chunks/ab12/ab12…", note: "a chunk already present is never sent or stored twice" },
      { label: "media", value: "the PBS server's disks (often ZFS)" },
    ],
  },
  {
    id: "btrfs",
    name: "BTRFS",
    type: "btrfs",
    level: "file",
    shared: "no",
    snapshots: "yes",
    thin: "yes",
    clones: "yes",
    formats: ["raw", "subvol"],
    content: ["images", "rootdir", "iso", "vztmpl", "backup", "snippets"],
    preview: true,
    blurb: "Copy-on-write filesystem with subvolume snapshots. Each VM disk is a raw file inside its own subvolume. Technology preview.",
    volid: "local-btrfs:100/vm-100-disk-0.raw",
    chain: [
      { label: "storage plugin", value: "btrfs: local-btrfs  path /var/lib/pve/local-btrfs" },
      { label: "file", value: "/var/lib/pve/local-btrfs/images/100/vm-100-disk-0/disk.raw", note: "the directory vm-100-disk-0 is a subvolume, snapshotted as a unit" },
      { label: "filesystem", value: "btrfs (raid1 profile across disks)" },
      { label: "media", value: "/dev/sda3, /dev/sdb3" },
    ],
  },
];

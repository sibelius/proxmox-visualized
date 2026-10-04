import { Fragment } from "react";
import { Code } from "@/components/code/Code";
import { CloneVisualizer } from "@/components/templates/CloneVisualizer";
import { CloudInitLab } from "@/components/templates/CloudInitLab";
import { Callout, PageHeader, Section, Takeaways } from "@/components/ui";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/templates");

const RECIPE = `
# 1. A cloud image: a small disk with cloud-init preinstalled
wget https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2

# 2. An empty VM with the right virtual hardware
qm create 9000 --name debian13-tmpl --ostype l26 --machine q35 \\
  --cpu x86-64-v2-AES --cores 2 --memory 2048 \\
  --scsihw virtio-scsi-single --net0 virtio,bridge=vmbr0 \\
  --agent enabled=1 --serial0 socket --vga serial0   # cloud images log to serial

# 3. Import the image as scsi0
qm set 9000 --scsi0 local-lvm:0,import-from=/root/debian-13-genericcloud-amd64.qcow2,discard=on,iothread=1
#   older two-step equivalent:
#   qm disk import 9000 debian-13-genericcloud-amd64.qcow2 local-lvm   (a.k.a. qm importdisk)
#   qm set 9000 --scsi0 local-lvm:vm-9000-disk-0

# 4. Cloud-init drive, boot from the imported disk, grow it
qm set 9000 --ide2 local-lvm:cloudinit
qm set 9000 --boot order=scsi0
qm disk resize 9000 scsi0 32G

# 5. Freeze it: disks become base-9000-disk-*, config gets "template: 1"
qm template 9000

# 6. Stamp out machines
qm clone 9000 201 --name web01                          # linked (default for templates)
qm clone 9000 202 --name db01 --full --storage ceph-vm  # independent copy, any storage
qm set 201 --ciuser ops --sshkeys ~/.ssh/id_ed25519.pub --ipconfig0 ip=10.0.10.21/24,gw=10.0.10.1
qm start 201
`;

const CONF = `
# /etc/pve/qemu-server/9000.conf after "qm template"
agent: enabled=1
boot: order=scsi0
cores: 2
cpu: x86-64-v2-AES
ide2: local-lvm:vm-9000-cloudinit,media=cdrom
machine: q35
memory: 2048
name: debian13-tmpl
net0: virtio=BC:24:11:0D:90:00,bridge=vmbr0
scsi0: local-lvm:base-9000-disk-0,discard=on,iothread=1,size=32G
scsihw: virtio-scsi-single
serial0: socket
template: 1
vga: serial0
`;

const SNIPPET = `
# Let a storage hold snippets, then drop a vendor-data file there
pvesm set local --content iso,vztmpl,backup,snippets

cat > /var/lib/vz/snippets/vendor.yaml <<'EOF'
#cloud-config
packages:
  - qemu-guest-agent
runcmd:
  - systemctl enable --now qemu-guest-agent
EOF

# vendor= is merged with the user-data Proxmox generates (ciuser, sshkeys stay);
# user= would replace it entirely.
qm set 9000 --cicustom "vendor=local:snippets/vendor.yaml"
qm cloudinit update 201      # regenerate the drive after changing settings
`;

export default function Page() {
  return (
    <>
      <PageHeader n="03" title="Templates & cloud-init">
        Installing an OS from an ISO for every VM doesn&apos;t scale. Proxmox&apos;s answer is two separate ideas that work
        together: a <span className="text-ink">template</span> is a frozen, read-only VM you clone (copying data cheaply
        or not at all), and <span className="text-ink">cloud-init</span> gives each clone its own identity (hostname,
        user, SSH keys, IP) on its first boot. Together they turn &quot;new server&quot; into a few seconds and one API
        call.
      </PageHeader>

      <CloneVisualizer />

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Callout title="Linked clone: fast and tiny, but tethered">
          Created in a second regardless of disk size, stores only what differs. But it lives on the template&apos;s
          storage, depends on the base forever, and the template can&apos;t be deleted while any linked clone exists. Needs
          a storage with snapshots/clones: LVM-thin, ZFS, Ceph RBD or qcow2 files.
        </Callout>
        <Callout tone="ok" title="Full clone: slower, independent">
          A complete copy of every allocated block, to any storage (local to Ceph, LVM to ZFS). Takes time proportional to
          used size, but the result has no ties to the template. Cloning a normal VM (not a template) is always full.
        </Callout>
      </div>

      <Section kicker="identity on first boot" title="The cloud-init drive">
        Adding <code className="font-mono text-ink">ide2: local-lvm:cloudinit</code> gives the VM a tiny generated ISO.
        Proxmox writes the cloud-init settings from the VM config into it (NoCloud format for Linux, ConfigDrive2 for
        Windows via cloudbase-init), and the cloud-init package inside the image reads it at boot. Change the fields
        below and watch the generated files and the instance-id change.
      </Section>
      <CloudInitLab />

      <Section kicker="the recipe" title="Building a cloud-image template from the CLI">
        The classic sequence: create an empty VM, import a vendor cloud image as its disk, attach a cloud-init drive,
        convert to template, clone. The same steps are what Packer or Terraform automate.
      </Section>
      <Code lang="bash" code={RECIPE} title="build-template.sh" />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Code lang="ini" code={CONF} title="the resulting template config" />
        </div>
        <div className="flex flex-col gap-4">
          <Callout tone="warn" title="Bake in the guest agent">
            Most cloud images don&apos;t ship qemu-guest-agent. Without it Proxmox can&apos;t show the VM&apos;s IP, freeze
            file systems for backups, or shut it down cleanly. Install it via a vendor snippet (below) or bake it into the
            image.
          </Callout>
        </div>
      </div>

      <Section kicker="beyond the basic fields" title="cicustom snippets">
        The built-in fields cover users, keys and networking. For packages, files and commands, point{" "}
        <code className="font-mono text-ink">cicustom</code> at YAML snippets on a storage that allows the snippets
        content type. Snippets must exist on every node that may start the VM (use shared storage in a cluster).
      </Section>
      <Code lang="bash" code={SNIPPET} title="vendor-data snippet" />

      <Takeaways
        items={[
          <Fragment key="a">
            A <span className="text-ink">linked clone</span> is copy-on-write: it shares every untouched block with the
            base. That&apos;s why the base must be a read-only template and why it can&apos;t be deleted while clones exist.
          </Fragment>,
          <Fragment key="b">
            Templates hold the <span className="text-ink">common</span> part; cloud-init injects the{" "}
            <span className="text-ink">unique</span> part (hostname, user, keys, IP), so one image serves every VM and
            clones don&apos;t share SSH host keys.
          </Fragment>,
          <Fragment key="c">
            The cloud-init drive is <span className="text-ink">regenerated from the VM config</span>: change settings, then
            regenerate and reboot. A new instance-id makes cloud-init re-run its per-instance steps.
          </Fragment>,
        ]}
      />
    </>
  );
}

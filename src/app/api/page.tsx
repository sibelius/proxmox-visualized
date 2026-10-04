import { Fragment } from "react";
import { AclEvaluator } from "@/components/api/AclEvaluator";
import { AuthFlow } from "@/components/api/AuthFlow";
import { Code } from "@/components/code/Code";
import { Callout, PageHeader, Section, Takeaways } from "@/components/ui";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/api");

const PVESH = `
# pvesh walks the same tree as /api2/json, without HTTP
pvesh ls /nodes/pve1/qemu                          # list children
pvesh get /cluster/resources --type vm --output-format json-pretty
pvesh get /nodes/pve1/qemu/100/status/current
pvesh create /nodes/pve1/qemu/100/status/start     # POST
pvesh set /nodes/pve1/qemu/100/config --memory 4096  # PUT
pvesh delete /nodes/pve1/qemu/100/snapshot/pre-upgrade

# The same call over HTTPS with a token
curl -s -H 'Authorization: PVEAPIToken=terraform@pve!ci=2b4e1c8a-7f0d-4e7b-9a51-0c3f6d2e9b17' \\
  https://pve1.example.com:8006/api2/json/nodes/pve1/qemu/100/status/current | jq .data.status
`;

const PVEUM = `
# A least-privilege identity for Terraform
pveum user add terraform@pve --comment "IaC pipeline"
pveum role add TerraformProv --privs "VM.Allocate VM.Audit VM.Clone \\
  VM.Config.CDROM VM.Config.CPU VM.Config.Cloudinit VM.Config.Disk \\
  VM.Config.HWType VM.Config.Memory VM.Config.Network VM.Config.Options \\
  VM.PowerMgmt Datastore.AllocateSpace Datastore.Audit SDN.Use"

pveum pool add dev
pveum acl modify /pool/dev                --users terraform@pve --roles TerraformProv
pveum acl modify /storage/local-lvm       --users terraform@pve --roles TerraformProv
pveum acl modify /sdn/zones/localnetwork  --users terraform@pve --roles TerraformProv

# The token: privsep=1, so it also needs its own ACLs (a subset)
pveum user token add terraform@pve ci --privsep 1
pveum acl modify /pool/dev --tokens 'terraform@pve!ci' --roles TerraformProv

pveum user permissions terraform@pve --path /pool/dev   # debug: what does it end up with?
`;

const TF = `
terraform {
  required_providers {
    proxmox = {
      source = "bpg/proxmox"
    }
  }
}

provider "proxmox" {
  endpoint  = "https://pve1.example.com:8006/"
  api_token = var.pve_api_token # "terraform@pve!ci=2b4e1c8a-…"
}

resource "proxmox_virtual_environment_vm" "web" {
  name      = "web-01"
  node_name = "pve1"
  pool_id   = "dev"

  clone {
    vm_id = 9000
    full  = false # linked clone of the template
  }

  cpu {
    cores = 2
    type  = "x86-64-v2-AES"
  }

  memory {
    dedicated = 2048
  }

  agent {
    enabled = true
  }

  network_device {
    bridge = "vmbr0"
  }

  initialization {
    ip_config {
      ipv4 {
        address = "10.0.10.31/24"
        gateway = "10.0.10.1"
      }
    }
    user_account {
      username = "ops"
      keys     = [trimspace(file("~/.ssh/id_ed25519.pub"))]
    }
  }
}
`;

const ANSIBLE = `
# community.proxmox (the modules formerly in community.general)
- hosts: localhost
  gather_facts: false
  vars:
    pve: &pve
      api_host: pve1.example.com
      api_user: ansible@pve
      api_token_id: ci
      api_token_secret: "{{ vault_pve_token_secret }}"
      node: pve1
  tasks:
    - name: Linked clone of template 9000
      community.proxmox.proxmox_kvm:
        <<: *pve
        clone: debian13-tmpl
        vmid: 9000
        newid: 202
        name: web-02
        full: false
        pool: dev

    - name: Cloud-init settings, then start
      community.proxmox.proxmox_kvm:
        <<: *pve
        vmid: 202
        ciuser: ops
        sshkeys: "{{ lookup('file', '~/.ssh/id_ed25519.pub') }}"
        ipconfig:
          ipconfig0: ip=10.0.10.32/24,gw=10.0.10.1
        update: true
    - community.proxmox.proxmox_kvm:
        <<: *pve
        vmid: 202
        state: started
`;

const PACKER = `
packer {
  required_plugins {
    proxmox = {
      source  = "github.com/hashicorp/proxmox"
      version = ">= 1.2.0"
    }
  }
}

source "proxmox-iso" "debian13" {
  proxmox_url = "https://pve1.example.com:8006/api2/json"
  username    = "packer@pve!build"
  token       = var.pve_token
  node        = "pve1"
  vm_id       = 9100

  boot_iso {
    iso_file = "local:iso/debian-13.1.0-amd64-netinst.iso"
    unmount  = true
  }
  http_directory = "http" # serves preseed.cfg
  boot_command   = ["<esc><wait>auto url=http://{{ .HTTPIP }}:{{ .HTTPPort }}/preseed.cfg<enter>"]

  cores           = 2
  memory          = 2048
  scsi_controller = "virtio-scsi-single"
  disks {
    disk_size    = "16G"
    storage_pool = "local-lvm"
    type         = "scsi"
  }
  network_adapters {
    bridge = "vmbr0"
    model  = "virtio"
  }

  cloud_init              = true
  cloud_init_storage_pool = "local-lvm"
  template_name           = "debian13-golden"
  ssh_username            = "root"
  ssh_password            = var.build_password
}

build {
  sources = ["source.proxmox-iso.debian13"]
}
`;

const REALMS = [
  { k: "pam", d: "Linux PAM on the node. root@pam lives here. Users must exist on every node separately: fine for a few admins, bad for teams." },
  { k: "pve", d: "Proxmox VE authentication server: password hashes in /etc/pve/priv/shadow.cfg, so cluster-wide automatically. Good for service accounts." },
  { k: "ldap / ad", d: "Bind against LDAP or Active Directory. pveum realm sync imports users and groups so you can put ACLs on directory groups." },
  { k: "openid", d: "OpenID Connect SSO (Keycloak, Entra ID, Authentik…). Optional auto-create of users on first login; roles still come from Proxmox ACLs." },
];

export default function Page() {
  return (
    <>
      <PageHeader n="14" title="API, users & automation">
        Everything in Proxmox VE goes through one REST API under <code className="font-mono text-ink">/api2/json</code>: the
        web UI, the CLI tools, Terraform, Ansible and the Kubernetes drivers. So &quot;who can do what&quot; has exactly one
        answer, computed on every call from users, groups, tokens and ACLs stored in{" "}
        <code className="font-mono text-ink">/etc/pve/user.cfg</code>. Learn how that check works and automation stops
        being a guessing game of 403s.
      </PageHeader>

      <AuthFlow />

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {REALMS.map((r) => (
          <div key={r.k} className="rounded-xl border border-line bg-panel p-4">
            <div className="font-mono text-sm text-accent">@{r.k}</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{r.d}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">
        A user ID is always <span className="font-mono">name@realm</span>: alice@pve and alice@corp-ad are two different users. Tokens add{" "}
        <span className="font-mono">!tokenid</span>.
      </p>

      <Section kicker="authorization" title="Paths, roles and the propagate flag">
        Permissions are <span className="text-ink">ACL entries</span>: (path, user | group | token, role, propagate). Paths
        form a tree: <span className="font-mono">/vms/&lt;id&gt;</span>, <span className="font-mono">/storage/&lt;id&gt;</span>,{" "}
        <span className="font-mono">/nodes/&lt;node&gt;</span>, <span className="font-mono">/pool/&lt;name&gt;</span>,{" "}
        <span className="font-mono">/sdn/zones/&lt;zone&gt;/&lt;vnet&gt;</span>, <span className="font-mono">/access</span>. A role is
        just a named set of privileges such as <span className="font-mono">VM.PowerMgmt</span> or{" "}
        <span className="font-mono">Datastore.AllocateSpace</span>. Every API method declares the privilege and path it
        needs; pick a principal and an action below to see how Proxmox resolves it.
      </Section>
      <AclEvaluator />

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Callout title="Use pools to scope teams">
          Put a team&apos;s VMs (and storages) in a pool and grant the role on /pool/&lt;name&gt;. New VMs created into the pool are
          covered automatically; no per-VM ACLs to maintain.
        </Callout>
        <Callout tone="warn" title="Creating VMs needs more than VM.Allocate">
          A clone or create also checks Datastore.AllocateSpace on the target storage and, since PVE 8, SDN.Use on the bridge
          (/sdn/zones/localnetwork/vmbr0 for plain Linux bridges). Missing one of those is the classic Terraform 403.
        </Callout>
      </div>

      <Section kicker="the api from a shell" title="pvesh mirrors the REST tree">
        <span className="font-mono">get</span>, <span className="font-mono">create</span>, <span className="font-mono">set</span>,{" "}
        <span className="font-mono">delete</span> map to GET, POST, PUT, DELETE on the same paths. The API viewer at{" "}
        <span className="font-mono">https://&lt;node&gt;:8006/pve-docs/api-viewer/</span> lists every endpoint with its
        parameters and required permissions.
      </Section>
      <div className="grid gap-4 xl:grid-cols-2">
        <Code lang="bash" code={PVESH} title="pvesh & curl" />
        <Code lang="bash" code={PVEUM} title="least-privilege service account" />
      </div>

      <Section kicker="automation" title="Terraform, Ansible, Packer">
        The common pattern: Packer builds a golden template, Terraform declares the VMs cloned from it (with cloud-init
        for identity), Ansible configures what runs inside. All three authenticate with an API token.
      </Section>
      <div className="grid gap-4 xl:grid-cols-2">
        <Code lang="hcl" code={TF} title="main.tf · bpg/proxmox provider" />
        <div className="flex flex-col gap-4">
          <Code lang="yaml" code={ANSIBLE} title="playbook.yml · community.proxmox" />
        </div>
      </div>
      <div className="mt-4">
        <Code lang="hcl" code={PACKER} title="debian13.pkr.hcl · proxmox-iso builder" />
      </div>

      <Takeaways
        items={[
          <Fragment key="a">
            <span className="text-ink">One API, one permission check.</span> The UI, pvesh, qm and Terraform all hit the same
            handlers, so a 403 names the exact path and privilege that&apos;s missing.
          </Fragment>,
          <Fragment key="b">
            Inheritance is <span className="text-ink">most specific wins</span>: deeper ACLs replace inherited ones, user
            entries beat group entries, NoAccess cancels everything, and propagate=0 stops at its own path.
          </Fragment>,
          <Fragment key="c">
            Give automation <span className="text-ink">privilege-separated API tokens</span>: no CSRF or ticket renewal, a
            revocable secret per pipeline, and never more power than the owning user.
          </Fragment>,
        ]}
      />
    </>
  );
}

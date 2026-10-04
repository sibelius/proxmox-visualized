"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Panel, Pill, Segmented, Toggle } from "../ui";

type Vm = { vmid: number; name: string; node: number; role: "control-plane" | "worker"; cpu: number; mem: number };

const REGION = "pve-dc1";
const NODES = ["pve1", "pve2", "pve3"];
const VMS: Vm[] = [
  { vmid: 101, name: "cp-1", node: 0, role: "control-plane", cpu: 2, mem: 4 },
  { vmid: 201, name: "worker-1", node: 0, role: "worker", cpu: 4, mem: 8 },
  { vmid: 102, name: "cp-2", node: 1, role: "control-plane", cpu: 2, mem: 4 },
  { vmid: 202, name: "worker-2", node: 1, role: "worker", cpu: 4, mem: 8 },
  { vmid: 103, name: "cp-3", node: 2, role: "control-plane", cpu: 2, mem: 4 },
  { vmid: 203, name: "worker-3", node: 2, role: "worker", cpu: 4, mem: 8 },
];

/* ---------------- CCM ---------------- */

export function CcmDemo() {
  const [ccm, setCcm] = useState(true);
  const [sel, setSel] = useState(202);
  const [deleted, setDeleted] = useState<number[]>([]);
  const vm = VMS.find((v) => v.vmid === sel)!;
  const isDeleted = deleted.includes(sel);

  const yaml = isDeleted
    ? ccm
      ? `# VM ${vm.vmid} no longer exists in Proxmox.\n# cloud-node-lifecycle noticed and deleted the Node:\n$ kubectl get node ${vm.name}\nError from server (NotFound): nodes "${vm.name}" not found`
      : `# VM ${vm.vmid} is gone, but nobody tells Kubernetes:\n$ kubectl get node ${vm.name}\nNAME       STATUS     ROLES    AGE\n${vm.name}   NotReady   <none>   41d\n# pods stay "Terminating"/stuck until a human deletes the Node`
    : ccm
      ? `apiVersion: v1
kind: Node
metadata:
  name: ${vm.name}
  labels:
    topology.kubernetes.io/region: ${REGION}
    topology.kubernetes.io/zone: ${NODES[vm.node]}
    node.kubernetes.io/instance-type: ${vm.cpu}VCPU-${vm.mem}GB
spec:
  providerID: proxmox://${REGION}/${vm.vmid}
status:
  addresses:
  - type: InternalIP
    address: 10.20.0.${vm.vmid - 50}
  - type: Hostname
    address: ${vm.name}`
      : `apiVersion: v1
kind: Node
metadata:
  name: ${vm.name}
  labels: {}          # no region / zone
spec:
  taints:             # kubelet --cloud-provider=external
  - key: node.cloudprovider.kubernetes.io/uninitialized
    value: "true"
    effect: NoSchedule
  # no providerID: k8s can't map this Node to a VM`;

  return (
    <Panel
      title="Proxmox cluster “pve-dc1” → Kubernetes Nodes"
      right={<Toggle checked={ccm} onChange={setCcm} label="Proxmox CCM running" />}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-2 font-mono text-[11px] text-faint">
            region = Proxmox cluster · zone = Proxmox node · click a VM
          </div>
          <div className="grid grid-cols-3 gap-2">
            {NODES.map((n, i) => (
              <div key={n} className="rounded-xl border border-line bg-panel-2/40 p-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs text-ink">{n}</span>
                  {ccm && <span className="hidden font-mono text-[9px] text-accent sm:inline">zone</span>}
                </div>
                <div className="space-y-1.5">
                  {VMS.filter((v) => v.node === i).map((v) => {
                    const gone = deleted.includes(v.vmid);
                    return (
                      <button
                        key={v.vmid}
                        type="button"
                        onClick={() => setSel(v.vmid)}
                        className={clsx(
                          "w-full rounded-lg border px-2 py-1.5 text-left transition",
                          v.vmid === sel ? "border-accent bg-accent/10" : "border-line bg-bg hover:border-faint",
                          gone && "border-dashed opacity-40",
                        )}
                        aria-pressed={v.vmid === sel}
                      >
                        <div className="font-mono text-[11px] text-ink">{v.name}</div>
                        <div className="font-mono text-[9.5px] text-faint">
                          VM {v.vmid} {gone ? "· deleted" : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant={isDeleted ? "default" : "danger"}
              onClick={() => setDeleted((d) => (isDeleted ? d.filter((x) => x !== sel) : [...d, sel]))}
            >
              {isDeleted ? `↺ recreate VM ${sel}` : `qm destroy ${sel}`}
            </Button>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            {ccm
              ? "The CCM asks the Proxmox API which VM a Node runs on (by providerID, or by matching name/UUID on first contact) and writes down what the scheduler needs: where the VM is (region/zone), its size and its IPs. It also removes the taint so pods can be scheduled."
              : "Without a cloud provider the cluster still runs, but Kubernetes knows nothing about Proxmox. It can't spread replicas over physical hosts, CSI has no zone to pin volumes to, and deleted VMs leave behind Node objects that never come back."}
          </p>
        </div>
        <pre key={`${ccm}-${sel}-${isDeleted}`} className="overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11.5px] leading-relaxed text-muted animate-rise">
          {yaml.split("\n").map((l, i) => (
            <div key={i} className={clsx(/providerID|topology|instance-type/.test(l) && "text-accent", /taints|uninitialized|NotReady|NotFound/.test(l) && "text-warn")}>
              {l}
            </div>
          ))}
        </pre>
      </div>
    </Panel>
  );
}

/* ---------------- CSI ---------------- */

type Backend = "proxmox-csi" | "ceph-rbd";

const STEPS: Record<Backend, { who: string; what: string }[]> = {
  "proxmox-csi": [
    { who: "kubectl", what: "PVC data-postgres-0 (10Gi, storageClass proxmox-local-lvm) created: Pending, because of WaitForFirstConsumer" },
    { who: "scheduler", what: "Pod postgres-0 placed on worker-2 → its zone is pve2" },
    { who: "CSI controller", what: "CreateVolume via the Proxmox API: a new 10G disk on storage local-lvm of node pve2" },
    { who: "CSI controller", what: "ControllerPublish: hot-plug the disk into VM 202 as a new scsiN device (like qm set)" },
    { who: "CSI node plugin", what: "inside worker-2: find the new SCSI disk, mkfs.ext4 on first use, mount into the pod" },
    { who: "kubelet", what: "postgres-0 Running · PV has nodeAffinity zone=pve2" },
  ],
  "ceph-rbd": [
    { who: "kubectl", what: "PVC data-postgres-0 (10Gi, storageClass ceph-rbd) created" },
    { who: "ceph-csi controller", what: "CreateVolume: rbd create kubernetes/csi-vol-… on Proxmox's Ceph cluster (talks to the MONs, not the Proxmox API)" },
    { who: "scheduler", what: "Pod postgres-0 placed on worker-2: any node works, the volume has no zone" },
    { who: "ceph-csi node plugin", what: "inside worker-2: rbd map over the network → /dev/rbd0, mkfs, mount" },
    { who: "kubelet", what: "postgres-0 Running · data replicated 3× by Ceph across pve1..3" },
  ],
};

export function CsiDemo() {
  const [backend, setBackend] = useState<Backend>("proxmox-csi");
  const [step, setStep] = useState(0);
  const [drained, setDrained] = useState(false);
  const steps = STEPS[backend];
  const done = step >= steps.length - 1;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setStep((s) => s + 1), 1300);
    return () => clearTimeout(t);
  }, [step, done, backend]);

  const reset = (b: Backend) => {
    setBackend(b);
    setStep(0);
    setDrained(false);
  };

  const zonal = backend === "proxmox-csi";
  // where is the pod / disk
  const podNode = drained ? (zonal ? null : 2) : 1;
  const diskVisible = zonal ? step >= 2 : step >= 1;
  const attached = zonal ? step >= 3 : step >= 3;
  const mounted = done;

  return (
    <Panel
      title="A PersistentVolumeClaim becomes a disk"
      right={
        <Segmented<Backend>
          value={backend}
          onChange={reset}
          options={[
            { value: "proxmox-csi", label: "Proxmox CSI (local-lvm)" },
            { value: "ceph-rbd", label: "ceph-csi RBD" },
          ]}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <div className="grid grid-cols-3 gap-2">
            {NODES.map((n, i) => {
              const worker = VMS.find((v) => v.node === i && v.role === "worker")!;
              const hasPod = podNode === i && step >= (zonal ? 1 : 2);
              const hasDisk = zonal && i === 1 && diskVisible;
              return (
                <div key={n} className={clsx("rounded-xl border p-2 transition", drained && i === 1 ? "border-dashed border-warn/60 opacity-60" : "border-line bg-panel-2/40")}>
                  <div className="mb-1.5 flex items-center justify-between font-mono text-xs">
                    <span className="text-ink">{n}</span>
                    {drained && i === 1 && <span className="text-[9px] text-warn">maintenance</span>}
                  </div>
                  <div className={clsx("rounded-lg border bg-bg p-1.5", hasPod ? "border-f1/70" : "border-line")}>
                    <div className="font-mono text-[10.5px] text-ink">{worker.name}</div>
                    <div className="font-mono text-[9px] text-faint">VM {worker.vmid}</div>
                    {hasPod && (
                      <div className="mt-1 rounded border border-f1/50 bg-f1/10 px-1 py-0.5 font-mono text-[9.5px] text-f1 animate-rise">
                        postgres-0 {mounted ? "✓" : "…"}
                      </div>
                    )}
                    {zonal && attached && i === 1 && (
                      <div className="mt-1 font-mono text-[9px] text-accent animate-rise">scsi1 ← disk</div>
                    )}
                  </div>
                  <div className="mt-1.5 rounded-md border border-line/70 px-1.5 py-1 font-mono text-[9.5px] text-faint">
                    {zonal ? "local-lvm" : "Ceph OSDs"}
                    {hasDisk && <div className="mt-0.5 rounded bg-accent/20 px-1 text-accent animate-rise">10G pvc disk</div>}
                    {!zonal && diskVisible && <div className="mt-0.5 rounded bg-f3/20 px-1 text-f3 animate-rise">rbd replica</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {drained && (
            <div className={clsx("mt-3 rounded-lg border px-3 py-2 text-[13px] animate-rise", zonal ? "border-warn/50 bg-warn/5 text-warn" : "border-ok/50 bg-ok/5 text-ok")}>
              {zonal
                ? "postgres-0 Pending: 0/3 nodes are available: 1 node(s) had volume node affinity conflict… The disk lives on pve2's local storage; the pod can only run in zone pve2."
                : "postgres-0 rescheduled to worker-3 on pve3: RBD volumes can be mapped from any node that reaches Ceph."}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => reset(backend)}>↻ replay</Button>
            <Button variant={drained ? "default" : "danger"} disabled={!done} onClick={() => setDrained((d) => !d)}>
              {drained ? "bring pve2 back" : "take pve2 down for maintenance"}
            </Button>
          </div>
        </div>
        <ol className="space-y-1.5">
          {steps.map((s, i) => (
            <li
              key={`${backend}-${i}`}
              className={clsx(
                "rounded-lg border px-3 py-2 transition",
                i === step ? "border-accent bg-accent/5" : i < step ? "border-line bg-panel-2/40" : "border-line/50 opacity-40",
              )}
            >
              <div className="flex items-center gap-2">
                <Pill color={i <= step ? "var(--color-accent)" : undefined}>{i + 1}</Pill>
                <span className="text-xs font-medium text-ink">{s.who}</span>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{s.what}</p>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}

"use client";

import { useState } from "react";
import clsx from "clsx";
import { Panel, Segmented } from "@/components/ui";

type Policy = "conditional" | "freeze" | "failover" | "migrate";
type Action = "reboot" | "shutdown";

type Phase = { label: string; pve1: string[]; others: string[]; tone: "ok" | "warn" | "bad" | "info"; note: string };

const SVC = ["vm:100", "vm:101"];

function phases(policy: Policy, action: Action): Phase[] {
  const eff: Exclude<Policy, "conditional"> = policy === "conditional" ? (action === "reboot" ? "freeze" : "failover") : policy;
  const begin: Phase = { label: `${action} pve1`, pve1: SVC.map((s) => `${s} started`), others: [], tone: "info", note: `You run "${action === "reboot" ? "reboot" : "shutdown -h now"}" on pve1 (or click it in the GUI).` };
  const down = action === "reboot" ? "pve1 reboots (≈2 min)" : "pve1 is powered off";
  switch (eff) {
    case "freeze":
      return [
        begin,
        { label: "LRM asks CRM to freeze", pve1: SVC.map((s) => `${s} freeze`), others: [], tone: "warn", note: "Services are stopped and put into 'freeze': the CRM will not recover or move them." },
        { label: down, pve1: SVC.map((s) => `${s} freeze`), others: [], tone: action === "reboot" ? "warn" : "bad", note: action === "reboot" ? "Downtime = guest shutdown + node reboot + guest boot." : "They stay frozen as long as pve1 is off. No one else starts them: that could be hours." },
        { label: "pve1 back", pve1: SVC.map((s) => `${s} started`), others: [], tone: "ok", note: "Unfrozen and started again on the same node." },
      ];
    case "failover":
      return [
        begin,
        { label: "LRM stops services", pve1: SVC.map((s) => `${s} stopped`), others: [], tone: "warn", note: "Services are stopped cleanly but NOT frozen; the node is marked as shut down." },
        { label: `${down}, lock expires`, pve1: [], others: SVC.map((s) => `${s} recovery`), tone: "warn", note: "Once the node's LRM lock expires (≈2 min), the CRM treats it like a failed node and recovers the services elsewhere." },
        { label: "running elsewhere", pve1: [], others: SVC.map((s) => `${s} started`), tone: "ok", note: action === "reboot" ? "If pve1 came back before the lock expired, they would simply start there again." : "Downtime ≈ stop + lock expiry + start on new node." },
      ];
    case "migrate":
      return [
        begin,
        { label: "maintenance mode", pve1: [], others: SVC.map((s) => `${s} migrate`), tone: "info", note: "LRM puts pve1 into maintenance; the CRM live-migrates every HA service away (no guest downtime)." },
        { label: down, pve1: [], others: SVC.map((s) => `${s} started`), tone: "ok", note: "The shutdown only proceeds once pve1 runs no HA services." },
        { label: "pve1 back", pve1: SVC.map((s) => `${s} started`), others: [], tone: "ok", note: "Maintenance mode remembered where they came from, so they migrate back." },
      ];
  }
}

export function ShutdownPolicy() {
  const [policy, setPolicy] = useState<Policy>("conditional");
  const [action, setAction] = useState<Action>("reboot");
  const ps = phases(policy, action);
  return (
    <Panel
      title="Planned shutdown: what happens to HA guests?"
      right={
        <div className="flex flex-wrap gap-2">
          <Segmented value={action} onChange={setAction} options={["reboot", "shutdown"] as const} />
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-faint">datacenter.cfg → ha: shutdown_policy=</span>
        <Segmented value={policy} onChange={setPolicy} options={["conditional", "freeze", "failover", "migrate"] as const} />
      </div>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {ps.map((p, i) => (
          <li key={policy + action + i} className="animate-rise rounded-lg border border-line bg-panel-2/40 p-3" style={{ animationDelay: `${i * 90}ms` }}>
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-[10px] text-faint">{i + 1}</span>
              <span className={clsx("text-xs font-medium", p.tone === "ok" && "text-ok", p.tone === "warn" && "text-warn", p.tone === "bad" && "text-bad", p.tone === "info" && "text-info")}>{p.label}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["pve1", "others"] as const).map((k) => (
                <div key={k} className="rounded border border-line bg-bg p-1.5">
                  <div className="mb-1 font-mono text-[9px] text-faint">{k === "pve1" ? "pve1" : "pve2/3"}</div>
                  {p[k].length === 0 && <div className="font-mono text-[10px] text-faint">—</div>}
                  {p[k].map((s) => (
                    <div key={s} className="truncate font-mono text-[10px] text-muted">{s}</div>
                  ))}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">{p.note}</p>
          </li>
        ))}
      </ol>
      {policy === "conditional" && (
        <p className="mt-3 text-xs text-muted">
          <b className="text-ink">conditional</b> (the default) behaves like <b>freeze</b> on reboot and like <b>failover</b> on
          shutdown: a reboot is short, so waiting is cheaper than moving; a poweroff may last hours.
        </p>
      )}
    </Panel>
  );
}

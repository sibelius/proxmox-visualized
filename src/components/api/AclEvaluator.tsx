"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Panel, Toggle } from "../ui";

/* ---------- model ---------- */

const VMCONFIG = [
  "VM.Config.CDROM",
  "VM.Config.CPU",
  "VM.Config.Cloudinit",
  "VM.Config.Disk",
  "VM.Config.HWType",
  "VM.Config.Memory",
  "VM.Config.Network",
  "VM.Config.Options",
];

const ROLES: Record<string, string[]> = {
  Administrator: ["*"],
  NoAccess: [],
  PVEAuditor: ["VM.Audit", "Datastore.Audit", "Sys.Audit", "Pool.Audit", "SDN.Audit", "Mapping.Audit"],
  PVEVMAdmin: ["VM.Allocate", "VM.Audit", "VM.Backup", "VM.Clone", ...VMCONFIG, "VM.Console", "VM.Migrate", "VM.PowerMgmt", "VM.Snapshot", "VM.Snapshot.Rollback"],
  PVEVMUser: ["VM.Audit", "VM.Backup", "VM.Config.CDROM", "VM.Config.Cloudinit", "VM.Console", "VM.PowerMgmt"],
  PVEDatastoreUser: ["Datastore.AllocateSpace", "Datastore.Audit"],
  PVESDNUser: ["SDN.Audit", "SDN.Use"],
  TerraformProv: ["VM.Allocate", "VM.Audit", "VM.Clone", ...VMCONFIG, "VM.PowerMgmt", "Datastore.AllocateSpace", "Datastore.Audit", "SDN.Use"],
};

type Who = { id: string; label: string; kind: "user" | "token"; groups: string[]; owner?: string };

const PRINCIPALS: Who[] = [
  { id: "alice@pve", label: "alice@pve", kind: "user", groups: ["ops"] },
  { id: "bob@corp-ad", label: "bob@corp-ad", kind: "user", groups: ["devs"] },
  { id: "terraform@pve!ci", label: "terraform@pve!ci", kind: "token", groups: [], owner: "terraform@pve" },
];
const USERS: Record<string, Who> = {
  "alice@pve": PRINCIPALS[0],
  "bob@corp-ad": PRINCIPALS[1],
  "terraform@pve": { id: "terraform@pve", label: "terraform@pve", kind: "user", groups: [] },
};

const POOL_OF_VM: Record<string, string> = { "101": "dev", "102": "dev", "9000": "dev" };

type Acl = { id: string; path: string; who: string; role: string; propagate: boolean; enabled: boolean };

const INITIAL: Acl[] = [
  { id: "a1", path: "/", who: "@ops", role: "PVEAuditor", propagate: true, enabled: true },
  { id: "a2", path: "/vms", who: "alice@pve", role: "PVEVMAdmin", propagate: false, enabled: true },
  { id: "a3", path: "/storage/backup-nfs", who: "@ops", role: "NoAccess", propagate: true, enabled: true },
  { id: "a4", path: "/pool/dev", who: "@devs", role: "PVEVMAdmin", propagate: true, enabled: true },
  { id: "a5", path: "/vms/100", who: "bob@corp-ad", role: "PVEVMUser", propagate: true, enabled: true },
  { id: "a6", path: "/storage/local-lvm", who: "@devs", role: "PVEDatastoreUser", propagate: true, enabled: true },
  { id: "a7", path: "/sdn/zones/localnetwork", who: "@devs", role: "PVESDNUser", propagate: true, enabled: true },
  { id: "a8", path: "/", who: "terraform@pve", role: "TerraformProv", propagate: true, enabled: true },
  { id: "a9", path: "/pool/dev", who: "terraform@pve!ci", role: "TerraformProv", propagate: true, enabled: true },
  { id: "a10", path: "/storage/local-lvm", who: "terraform@pve!ci", role: "TerraformProv", propagate: true, enabled: true },
  { id: "a11", path: "/sdn/zones/localnetwork", who: "terraform@pve!ci", role: "TerraformProv", propagate: true, enabled: false },
];

type Check = { path: string; priv: string };
const ACTIONS: { id: string; label: string; api: string; checks: Check[] }[] = [
  { id: "start100", label: "Start VM 100", api: "POST /nodes/pve1/qemu/100/status/start", checks: [{ path: "/vms/100", priv: "VM.PowerMgmt" }] },
  { id: "start101", label: "Start VM 101 (pool dev)", api: "POST /nodes/pve1/qemu/101/status/start", checks: [{ path: "/vms/101", priv: "VM.PowerMgmt" }] },
  { id: "audit102", label: "View VM 102 config", api: "GET /nodes/pve1/qemu/102/config", checks: [{ path: "/vms/102", priv: "VM.Audit" }] },
  {
    id: "clone",
    label: "Clone template 9000 → new VM in pool dev",
    api: "POST /nodes/pve1/qemu/9000/clone  newid=103 pool=dev storage=local-lvm",
    checks: [
      { path: "/vms/9000", priv: "VM.Clone" },
      { path: "/pool/dev", priv: "VM.Allocate" },
      { path: "/storage/local-lvm", priv: "Datastore.AllocateSpace" },
      { path: "/sdn/zones/localnetwork/vmbr0", priv: "SDN.Use" },
    ],
  },
  {
    id: "backup",
    label: "Back up VM 101 to backup-nfs",
    api: "POST /nodes/pve1/vzdump  vmid=101 storage=backup-nfs",
    checks: [
      { path: "/vms/101", priv: "VM.Backup" },
      { path: "/storage/backup-nfs", priv: "Datastore.AllocateSpace" },
    ],
  },
  { id: "browse", label: "Browse local-lvm contents", api: "GET /nodes/pve1/storage/local-lvm/content", checks: [{ path: "/storage/local-lvm", priv: "Datastore.Audit" }] },
  { id: "browsenfs", label: "Browse backup-nfs contents", api: "GET /nodes/pve1/storage/backup-nfs/content", checks: [{ path: "/storage/backup-nfs", priv: "Datastore.Audit" }] },
  { id: "syslog", label: "Read node syslog", api: "GET /nodes/pve1/syslog", checks: [{ path: "/nodes/pve1", priv: "Sys.Syslog" }] },
];

/* ---------- evaluation (mirrors PVE::AccessControl::roles) ---------- */

type EntryState = "applied" | "no-propagate" | "shadowed";
type Level = { path: string; entries: { acl: Acl; state: EntryState }[]; roles: string[]; changed: boolean };
type Walk = { title: string; path: string; levels: Level[]; roles: string[]; privs: Set<string> };

function ancestors(path: string) {
  const parts = path.split("/").filter(Boolean);
  const out = ["/"];
  for (let i = 1; i <= parts.length; i++) out.push("/" + parts.slice(0, i).join("/"));
  return out;
}

function privsOf(roles: string[]) {
  const s = new Set<string>();
  if (roles.includes("NoAccess")) return s;
  roles.forEach((r) => ROLES[r].forEach((p) => s.add(p)));
  return s;
}
const has = (privs: Set<string>, p: string) => privs.has("*") || privs.has(p);

function walk(who: Who, path: string, acls: Acl[], title: string): Walk {
  let roles: string[] = [];
  const levels: Level[] = [];
  for (const p of ancestors(path)) {
    const final = p === path;
    const here = acls.filter((a) => a.enabled && a.path === p);
    const mine = here.filter((a) => a.who === who.id);
    const groups = here.filter((a) => a.who.startsWith("@") && who.groups.includes(a.who.slice(1)));
    const entries: Level["entries"] = [];
    const userApplied = mine.filter((a) => final || a.propagate);
    mine.forEach((a) => entries.push({ acl: a, state: final || a.propagate ? "applied" : "no-propagate" }));
    let next: string[] | null = userApplied.length ? userApplied.map((a) => a.role) : null;
    if (next) {
      groups.forEach((a) => entries.push({ acl: a, state: "shadowed" }));
    } else {
      const gApplied = groups.filter((a) => final || a.propagate);
      groups.forEach((a) => entries.push({ acl: a, state: final || a.propagate ? "applied" : "no-propagate" }));
      if (gApplied.length) next = [...new Set(gApplied.map((a) => a.role))];
    }
    const changed = next !== null;
    if (next) roles = next;
    levels.push({ path: p, entries, roles: [...roles], changed });
  }
  if (roles.includes("NoAccess")) roles = ["NoAccess"];
  return { title, path, levels, roles, privs: privsOf(roles) };
}

/** Effective privileges at a path, including the pool a VM belongs to. */
function effective(who: Who, path: string, acls: Acl[], label: string): { walks: Walk[]; privs: Set<string> } {
  const walks = [walk(who, path, acls, label)];
  const m = path.match(/^\/vms\/(\d+)$/);
  if (m && POOL_OF_VM[m[1]]) walks.push(walk(who, `/pool/${POOL_OF_VM[m[1]]}`, acls, `${label} · via pool ${POOL_OF_VM[m[1]]}`));
  const privs = new Set<string>();
  walks.forEach((w) => w.privs.forEach((p) => privs.add(p)));
  return { walks, privs };
}

type Result = { check: Check; ok: boolean; walks: Walk[]; note?: string };

function evaluate(who: Who, privsep: boolean, check: Check, acls: Acl[]): Result {
  if (who.kind === "token") {
    const owner = USERS[who.owner!];
    const u = effective(owner, check.path, acls, `user ${owner.id}`);
    if (!privsep) {
      return { check, ok: has(u.privs, check.priv), walks: u.walks, note: "privsep=0: the token simply inherits its user's permissions." };
    }
    const t = effective(who, check.path, acls, `token ${who.id}`);
    const ok = has(u.privs, check.priv) && has(t.privs, check.priv);
    return {
      check,
      ok,
      walks: [...t.walks, ...u.walks],
      note: `privsep=1: effective = token ACLs ∩ user ACLs. Token ${has(t.privs, check.priv) ? "has" : "lacks"} it, user ${has(u.privs, check.priv) ? "has" : "lacks"} it.`,
    };
  }
  const e = effective(who, check.path, acls, who.id);
  return { check, ok: has(e.privs, check.priv), walks: e.walks };
}

/* ---------- UI ---------- */

const ROLE_COLOR = (r: string) =>
  r === "NoAccess" ? "#f87171" : r === "Administrator" ? "#e57000" : r === "PVEAuditor" ? "#60a5fa" : r === "TerraformProv" ? "#a78bfa" : "#34d399";

function WalkTable({ w, priv, hot }: { w: Walk; priv: string; hot: (id: string) => void }) {
  const ok = has(w.privs, priv);
  return (
    <div className="rounded-lg border border-line bg-bg/50">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="truncate font-mono text-[11px] text-muted">{w.title}</span>
        <span className={clsx("font-mono text-[11px]", ok ? "text-ok" : "text-bad")}>{ok ? `has ${priv}` : `no ${priv}`}</span>
      </div>
      <div className="divide-y divide-line/60">
        {w.levels.map((l) => (
          <div key={l.path} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-2 px-3 py-1.5 text-[12px]">
            <span className={clsx("font-mono break-all", l.path === w.path ? "text-ink" : "text-faint")}>{l.path}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              {l.entries.length === 0 && <span className="text-faint">·</span>}
              {l.entries.map(({ acl, state }) => (
                <span
                  key={acl.id}
                  onMouseEnter={() => hot(acl.id)}
                  onMouseLeave={() => hot("")}
                  className={clsx("truncate font-mono text-[11px]", state === "applied" ? "text-ink" : "text-faint line-through")}
                  title={state === "no-propagate" ? "propagate=0 and this is not the target path: ignored" : state === "shadowed" ? "a user ACL at this level overrides group ACLs" : "applies"}
                >
                  {acl.who} <span style={{ color: ROLE_COLOR(acl.role) }}>{acl.role}</span>
                  {state === "no-propagate" && <span className="text-warn no-underline"> (no propagate)</span>}
                  {state === "shadowed" && <span className="text-warn"> (user wins)</span>}
                </span>
              ))}
            </span>
            <span className="flex flex-wrap gap-1">
              {l.roles.length === 0 ? (
                <span className="text-faint">none</span>
              ) : (
                l.roles.map((r) => (
                  <span key={r} className={clsx("rounded px-1 font-mono text-[10.5px]", !l.changed && "opacity-60")} style={{ color: ROLE_COLOR(r), background: `${ROLE_COLOR(r)}18` }}>
                    {r}
                  </span>
                ))
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AclEvaluator() {
  const [acls, setAcls] = useState<Acl[]>(INITIAL);
  const [whoId, setWhoId] = useState("alice@pve");
  const [privsep, setPrivsep] = useState(true);
  const [actionId, setActionId] = useState("start101");
  const [sel, setSel] = useState(0);
  const [hot, setHot] = useState("");

  const who = PRINCIPALS.find((p) => p.id === whoId)!;
  const action = ACTIONS.find((a) => a.id === actionId)!;
  const results = useMemo(() => action.checks.map((c) => evaluate(who, privsep, c, acls)), [action, who, privsep, acls]);
  const allOk = results.every((r) => r.ok);
  const firstFail = results.find((r) => !r.ok);
  const shown = results[Math.min(sel, results.length - 1)];
  const involved = new Set(shown.walks.flatMap((w) => w.levels.flatMap((l) => l.entries.map((e) => e.acl.id))));

  const pickAction = (id: string) => {
    setActionId(id);
    const a = ACTIONS.find((x) => x.id === id)!;
    const rs = a.checks.map((c) => evaluate(who, privsep, c, acls));
    const f = rs.findIndex((r) => !r.ok);
    setSel(f >= 0 ? f : 0);
  };

  const userCfg = acls
    .filter((a) => a.enabled)
    .map((a) => `acl:${a.propagate ? 1 : 0}:${a.path}:${a.who}:${a.role}:`)
    .join("\n");

  return (
    <Panel title="ACL evaluator: who may do what, and why">
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* left: principal + action */}
        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <div className="mb-1.5 text-[11px] tracking-wide text-faint uppercase">principal</div>
            <div className="flex flex-col gap-1">
              {PRINCIPALS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setWhoId(p.id)}
                  className={clsx(
                    "flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left transition",
                    whoId === p.id ? "border-accent bg-accent/10" : "border-line hover:border-faint",
                  )}
                >
                  <span className="font-mono text-[12.5px] text-ink">{p.label}</span>
                  <span className="text-[10.5px] text-faint">{p.kind === "token" ? "API token" : p.groups.map((g) => `@${g}`).join(" ")}</span>
                </button>
              ))}
            </div>
            {who.kind === "token" && (
              <div className="mt-2">
                <Toggle checked={privsep} onChange={setPrivsep} label={<span className="font-mono text-[12px]">privsep (privilege separation)</span>} />
              </div>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-[11px] tracking-wide text-faint uppercase">action</div>
            <div className="flex flex-col gap-1">
              {ACTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pickAction(a.id)}
                  className={clsx(
                    "rounded-lg border px-2.5 py-1.5 text-left text-[13px] transition",
                    actionId === a.id ? "border-info bg-info/10 text-ink" : "border-line text-muted hover:border-faint hover:text-ink",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* right: result */}
        <div className="flex min-w-0 flex-col gap-3">
          <div
            key={`${whoId}-${actionId}-${allOk}-${privsep}`}
            className={clsx("animate-flash rounded-xl border px-4 py-3", allOk ? "border-ok/60 bg-ok/10" : "border-bad/60 bg-bad/10")}
          >
            <div className="font-mono text-[11.5px] break-all text-muted">{action.api}</div>
            <div className={clsx("mt-1 font-mono text-sm", allOk ? "text-ok" : "text-bad")}>
              {allOk ? "200 OK" : `403 Permission check failed (${firstFail!.check.path}, ${firstFail!.check.priv})`}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSel(i)}
                className={clsx(
                  "rounded-md border px-2 py-1 font-mono text-[11px] transition",
                  i === sel ? "border-ink/60 bg-panel-2" : "border-line",
                  r.ok ? "text-ok" : "text-bad",
                )}
              >
                {r.ok ? "✓" : "✗"} {r.check.priv} on {r.check.path}
              </button>
            ))}
          </div>

          <div className="grid gap-2">
            {shown.walks.map((w) => (
              <WalkTable key={w.title + w.path} w={w} priv={shown.check.priv} hot={setHot} />
            ))}
          </div>
          {shown.note && <p className="text-[12.5px] leading-relaxed text-muted">{shown.note}</p>}
          {shown.walks.length > 1 && who.kind === "user" && (
            <p className="text-[12.5px] leading-relaxed text-muted">A VM in a pool also gets the privileges granted on the pool path; the two are combined (union).</p>
          )}
        </div>
      </div>

      {/* ACL list */}
      <div className="mt-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] tracking-wide text-faint uppercase">ACL entries (toggle them)</div>
          <button type="button" onClick={() => setAcls(INITIAL)} className="text-xs text-muted hover:text-ink">
            reset
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[620px] text-[12.5px]">
            <thead>
              <tr className="bg-panel-2/60 text-left text-[11px] text-faint">
                <th className="px-3 py-1.5 font-medium">on</th>
                <th className="px-3 py-1.5 font-medium">path</th>
                <th className="px-3 py-1.5 font-medium">user / @group / token</th>
                <th className="px-3 py-1.5 font-medium">role</th>
                <th className="px-3 py-1.5 font-medium">propagate</th>
              </tr>
            </thead>
            <tbody>
              {acls.map((a) => (
                <tr
                  key={a.id}
                  className={clsx(
                    "border-t border-line transition-colors",
                    hot === a.id ? "bg-accent/15" : involved.has(a.id) ? "bg-info/5" : "",
                    !a.enabled && "opacity-45",
                  )}
                >
                  <td className="px-3 py-1">
                    <input
                      type="checkbox"
                      aria-label={`enable ACL ${a.path} ${a.who}`}
                      checked={a.enabled}
                      onChange={(e) => setAcls(acls.map((x) => (x.id === a.id ? { ...x, enabled: e.target.checked } : x)))}
                      className="accent-[var(--color-accent)]"
                    />
                  </td>
                  <td className="px-3 py-1 font-mono text-ink">{a.path}</td>
                  <td className="px-3 py-1 font-mono text-muted">{a.who}</td>
                  <td className="px-3 py-1 font-mono" style={{ color: ROLE_COLOR(a.role) }}>
                    {a.role}
                  </td>
                  <td className="px-3 py-1">
                    <input
                      type="checkbox"
                      aria-label={`propagate ACL ${a.path} ${a.who}`}
                      checked={a.propagate}
                      onChange={(e) => setAcls(acls.map((x) => (x.id === a.id ? { ...x, propagate: e.target.checked } : x)))}
                      className="accent-[var(--color-accent)]"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <pre className="overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">
            {`# /etc/pve/user.cfg (ACL lines: acl:<propagate>:<path>:<who>:<roles>:)\n${userCfg}`}
          </pre>
          <div className="rounded-lg border border-line bg-bg/50 p-3 text-[12.5px] leading-relaxed text-muted">
            <div className="mb-1 font-medium text-ink">Rules, as Proxmox applies them</div>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Walk the path from / down to the target. At each level, ACLs that apply replace what was inherited.</li>
              <li>An ACL with propagate=0 only counts on its exact path.</li>
              <li>At the same level, ACLs for the user override those for their groups.</li>
              <li>NoAccess in the final set cancels every other role.</li>
              <li>Pool members also get what&apos;s granted on /pool/&lt;name&gt;.</li>
              <li>A privsep token gets the intersection of its own ACLs and its user&apos;s.</li>
            </ol>
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
        Try: as alice, start VM 101, then tick propagate on her <span className="font-mono">/vms</span> entry · as alice, browse local-lvm vs backup-nfs (NoAccess) ·
        as the token, clone (then enable its SDN entry, or turn privsep off) · as bob, start VM 101 (granted via the pool).
      </p>
    </Panel>
  );
}

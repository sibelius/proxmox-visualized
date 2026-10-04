"use client";

import { useState } from "react";
import clsx from "clsx";
import { Callout, Mono, Panel, Segmented } from "../ui";

type Mode = "unpriv" | "passthrough" | "priv";

// [containerStart, hostStart, count]
const MAPS: Record<Mode, [number, number, number][]> = {
  unpriv: [[0, 100000, 65536]],
  passthrough: [
    [0, 100000, 1000],
    [1000, 1000, 1],
    [1001, 101001, 64535],
  ],
  priv: [[0, 0, 65536]],
};

const CONF: Record<Mode, string> = {
  unpriv: `# /etc/pve/lxc/101.conf
unprivileged: 1
mp0: /tank/media,mp=/srv/media

# /etc/subuid  and  /etc/subgid
root:100000:65536`,
  passthrough: `# /etc/pve/lxc/101.conf
unprivileged: 1
mp0: /tank/media,mp=/srv/media
lxc.idmap: u 0 100000 1000
lxc.idmap: g 0 100000 1000
lxc.idmap: u 1000 1000 1
lxc.idmap: g 1000 1000 1
lxc.idmap: u 1001 101001 64535
lxc.idmap: g 1001 101001 64535

# /etc/subuid  and  /etc/subgid  (allow root to map 1000)
root:100000:65536
root:1000:1`,
  priv: `# /etc/pve/lxc/101.conf
unprivileged: 0          # privileged: no user namespace
mp0: /tank/media,mp=/srv/media`,
};

const PRESETS = [
  { uid: 0, name: "root" },
  { uid: 33, name: "www-data" },
  { uid: 1000, name: "first user" },
  { uid: 65534, name: "nobody" },
];

// The bind-mounted directory on the host is owned by host UID 1000.
const FILE_OWNER_HOST = 1000;

function toHost(uid: number, mode: Mode): number | null {
  for (const [c, h, n] of MAPS[mode]) if (uid >= c && uid < c + n) return h + (uid - c);
  return null;
}
function toCt(host: number, mode: Mode): number | null {
  for (const [c, h, n] of MAPS[mode]) if (host >= h && host < h + n) return c + (host - h);
  return null;
}

// Drawing scales
const X0 = 40;
const X1 = 680;
const ctX = (u: number) => X0 + (u / 65536) * (X1 - X0);
const MID = 352; // gap between the two host blocks
const hostX = (h: number) => {
  if (h < 65536) return X0 + (h / 65536) * (MID - 14 - X0);
  return MID + 14 + ((h - 100000) / 65536) * (X1 - MID - 14);
};

export function UidMapper() {
  const [mode, setMode] = useState<Mode>("unpriv");
  const [uid, setUid] = useState(0);
  const host = toHost(uid, mode);
  const ownerInCt = toCt(FILE_OWNER_HOST, mode);
  const color = mode === "priv" ? "#f87171" : "#34d399";

  return (
    <Panel
      title="UID mapping in unprivileged containers"
      right={
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "unpriv", label: "unprivileged" },
            { value: "passthrough", label: "+ pass uid 1000" },
            { value: "priv", label: "privileged" },
          ]}
        />
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          UID inside CT 101
          <input
            type="number"
            min={0}
            max={65535}
            value={uid}
            onChange={(e) => setUid(Math.max(0, Math.min(65535, Number(e.target.value) || 0)))}
            className="w-24 rounded-md border border-line bg-bg px-2 py-1 font-mono text-sm text-ink"
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.uid}
              type="button"
              onClick={() => setUid(p.uid)}
              className={clsx(
                "rounded-md border px-2 py-0.5 font-mono text-[11px] transition",
                uid === p.uid ? "border-accent text-accent" : "border-line text-muted hover:text-ink",
              )}
            >
              {p.uid} {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox="0 0 720 210" className="min-w-[560px]" role="img" aria-label={`Container UID ${uid} maps to host UID ${host ?? "none"}`}>
          <text x={X0} y={22} fill="#8a93a8" fontSize={11}>
            inside the container (what `id` prints)
          </text>
          <rect x={X0} y={30} width={X1 - X0} height={16} rx={4} fill="#171b24" stroke="#242a38" />
          <text x={X0} y={60} fill="#5a6275" fontSize={10} fontFamily="var(--font-mono)">
            0
          </text>
          <text x={X1} y={60} fill="#5a6275" fontSize={10} fontFamily="var(--font-mono)" textAnchor="end">
            65535
          </text>

          {MAPS[mode].map(([c, h, n], k) => {
            const a = ctX(c);
            const b = ctX(c + n);
            const ha = hostX(h);
            const hb = hostX(h + n - 1) + (n === 1 ? 2 : 0);
            const fill = h === c ? (mode === "priv" ? "#f87171" : "#fbbf24") : "#34d399";
            return (
              <g key={`${mode}-${k}`} className="animate-rise">
                <rect x={a} y={30} width={Math.max(2, b - a)} height={16} fill={`${fill}55`} />
                <path d={`M ${a} 46 L ${b} 46 L ${hb} 150 L ${ha} 150 Z`} fill={`${fill}1c`} stroke={`${fill}55`} strokeWidth={0.8} />
                <rect x={ha} y={150} width={Math.max(2, hb - ha)} height={16} fill={`${fill}55`} />
              </g>
            );
          })}

          <text x={X0} y={186} fill="#8a93a8" fontSize={11}>
            on the host (what `ps` / `ls -n` show)
          </text>
          <rect x={X0} y={150} width={MID - 14 - X0} height={16} rx={4} fill="none" stroke="#242a38" />
          <rect x={MID + 14} y={150} width={X1 - MID - 14} height={16} rx={4} fill="none" stroke="#242a38" />
          <text x={MID} y={163} fill="#5a6275" fontSize={12} textAnchor="middle">
            ⋯
          </text>
          <text x={X0} y={180 + 20} fill="#5a6275" fontSize={10} fontFamily="var(--font-mono)">
            0 … 65535 (host's real users)
          </text>
          <text x={X1} y={200} fill="#5a6275" fontSize={10} fontFamily="var(--font-mono)" textAnchor="end">
            100000 … 165535 (subuid range)
          </text>

          {/* selected uid */}
          <circle cx={ctX(uid)} cy={38} r={5} fill="#e7e9f0" stroke="#0a0c11" strokeWidth={2} />
          {host !== null && (
            <>
              <line x1={ctX(uid)} y1={46} x2={hostX(host)} y2={150} stroke={color} strokeWidth={1.8} style={{ transition: "all 300ms" }} />
              <circle cx={hostX(host)} cy={158} r={5} fill={color} stroke="#0a0c11" strokeWidth={2} />
            </>
          )}
        </svg>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
            <span className="rounded-md border border-line bg-bg px-2 py-1">CT uid {uid}</span>
            <span className="text-faint">→</span>
            <span className="rounded-md border px-2 py-1" style={{ borderColor: color, color }}>
              host uid {host ?? "unmapped"}
            </span>
          </div>
          {mode === "priv" ? (
            <Callout tone="bad" title="Root in the container is root on the host">
              No user namespace: UID 0 inside is UID 0 outside. Only AppArmor and dropped capabilities stand between a
              compromised container and the host. Use only for trusted workloads that truly need it.
            </Callout>
          ) : (
            <Callout tone="ok" title={uid === 0 ? "Container root is a nobody on the host" : "Shifted out of the host's user space"}>
              Root inside CT 101 is UID {toHost(0, mode)} on the host: it owns nothing there. Even if a process escapes the
              namespace, it lands as an unprivileged user.
            </Callout>
          )}
          <div className="rounded-lg border border-line bg-bg/50 p-3 text-sm leading-relaxed text-muted">
            <div className="mb-1 font-mono text-xs text-faint">bind mount /tank/media → /srv/media, owned by host uid 1000</div>
            {ownerInCt === null ? (
              <>
                Inside the CT the files show up as <span className="font-mono text-bad">nobody:nogroup (65534)</span>: host
                1000 isn&apos;t in the map. The container can read world-readable files but can&apos;t write. This is the
                classic &quot;permission denied on my bind mount&quot; problem.
              </>
            ) : ownerInCt === 1000 && mode === "passthrough" ? (
              <>
                Inside the CT the owner is <span className="font-mono text-ok">uid 1000</span>, the same user as on the host:
                reads and writes work, while root is still shifted to 100000.
              </>
            ) : (
              <>
                Owner shows as <span className="font-mono text-warn">uid {ownerInCt}</span>: works, because nothing is shifted
                at all.
              </>
            )}
          </div>
        </div>
        <Mono className="text-[11.5px]">{CONF[mode]}</Mono>
      </div>
    </Panel>
  );
}

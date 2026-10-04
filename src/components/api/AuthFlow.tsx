"use client";

import { useState } from "react";
import clsx from "clsx";
import { Button, Panel, Segmented } from "../ui";

type Mode = "ticket" | "token";
type Msg = { dir: "req" | "res"; text: string; status?: "ok" | "bad"; note: string };

const FLOWS: Record<Mode, Msg[]> = {
  ticket: [
    {
      dir: "req",
      text: "POST /api2/json/access/ticket\nusername=alice@pve&password=••••••",
      note: "Log in once with a password against a realm (pam, pve, LDAP, AD or OpenID Connect). With 2FA configured, the first answer asks for the second factor.",
    },
    {
      dir: "res",
      status: "ok",
      text: '200 {"data":{\n  "ticket":"PVE:alice@pve:6720B1C4::Zm9v…",\n  "CSRFPreventionToken":"6720B1C4:Y2Fs…",\n  "username":"alice@pve" }}',
      note: "The ticket is signed with the cluster's private key in /etc/pve/priv/authkey.key, so every node can verify it with the public key: log in on pve1, talk to pve3. It is valid for 2 hours.",
    },
    {
      dir: "req",
      text: "GET /api2/json/cluster/resources\nCookie: PVEAuthCookie=PVE:alice@pve:6720B1C4::Zm9v…",
      note: "Reads just need the cookie. The browser sends it automatically, which is exactly the problem for writes…",
    },
    { dir: "res", status: "ok", text: '200 {"data":[{"id":"qemu/100","status":"running",…}]}', note: "Only the resources alice has at least audit rights on are listed." },
    {
      dir: "req",
      text: "POST /api2/json/nodes/pve1/qemu/100/status/start\nCookie: PVEAuthCookie=…",
      note: "A write with only the cookie, which is what a malicious page could make your browser send (cross-site request forgery).",
    },
    { dir: "res", status: "bad", text: "401 Permission denied - invalid csrf token", note: "Rejected: the cookie alone proves nothing about who built the request." },
    {
      dir: "req",
      text: "POST /api2/json/nodes/pve1/qemu/100/status/start\nCookie: PVEAuthCookie=…\nCSRFPreventionToken: 6720B1C4:Y2Fs…",
      note: "The CSRF token came in the JSON body of the login response. Only JavaScript running on the Proxmox origin could read it, so its presence proves the request came from the real UI or client.",
    },
    { dir: "res", status: "ok", text: '200 {"data":"UPID:pve1:0003A1F2:…:qmstart:100:alice@pve:"}', note: "Clients renew before the 2 h expiry by posting the current ticket as the password to /access/ticket." },
  ],
  token: [
    {
      dir: "req",
      text: "# once, as an admin\npveum user token add terraform@pve ci --privsep 1",
      note: "A token belongs to a user. The secret (a UUID) is shown exactly once. Optional --expire; otherwise it lives until removed.",
    },
    {
      dir: "res",
      status: "ok",
      text: "full-tokenid: terraform@pve!ci\nvalue: 2b4e1c8a-7f0d-4e7b-9a51-0c3f6d2e9b17",
      note: "Store it in your secret manager. Revoke it any time without touching the user's password or other tokens.",
    },
    {
      dir: "req",
      text: "POST /api2/json/nodes/pve1/qemu/9000/clone\nAuthorization: PVEAPIToken=terraform@pve!ci=2b4e1c8a-…",
      note: "Every request carries the token in a header. No login round-trip, no ticket to renew, and no CSRF token: a browser never attaches this header on its own, so CSRF doesn't apply.",
    },
    {
      dir: "res",
      status: "ok",
      text: '200 {"data":"UPID:pve1:…:qmclone:9000:terraform@pve!ci:"}',
      note: "The task log and audit trail show the token, not just the user, so you can tell which pipeline did what.",
    },
    {
      dir: "req",
      text: "DELETE /api2/json/access/users/terraform@pve\nAuthorization: PVEAPIToken=terraform@pve!ci=…",
      note: "With privsep=1 the token can never do more than its user, and only what its own ACLs allow.",
    },
    { dir: "res", status: "bad", text: "403 Permission check failed (/access, User.Modify)", note: "Least privilege: give each automation its own token with only the paths and roles it needs." },
  ],
};

export function AuthFlow() {
  const [mode, setMode] = useState<Mode>("ticket");
  const [n, setN] = useState(1);
  const flow = FLOWS[mode];
  const cur = flow[n - 1];

  return (
    <Panel
      title="Authenticating to /api2/json"
      right={
        <Segmented
          value={mode}
          onChange={(m) => {
            setMode(m);
            setN(1);
          }}
          options={[
            { value: "ticket", label: "ticket + CSRF (UI, scripts)" },
            { value: "token", label: "API token (automation)" },
          ]}
        />
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-2 grid grid-cols-2 font-mono text-[11px] text-faint">
            <span>{mode === "ticket" ? "browser / client" : "terraform / CI"}</span>
            <span className="text-right">pveproxy :8006</span>
          </div>
          <div className="relative flex flex-col gap-2 border-x border-dashed border-line px-2 py-1">
            {flow.slice(0, n).map((m, i) => (
              <div key={`${mode}-${i}`} className={clsx("flex animate-rise", m.dir === "req" ? "justify-start" : "justify-end")}>
                <button
                  type="button"
                  onClick={() => setN(i + 1)}
                  className={clsx(
                    "max-w-[88%] rounded-lg border px-3 py-2 text-left transition",
                    i === n - 1 ? "bg-panel-2" : "bg-bg/60 opacity-70 hover:opacity-100",
                    m.dir === "req" ? "border-info/50" : m.status === "bad" ? "border-bad/60" : "border-ok/50",
                  )}
                >
                  <div className="mb-0.5 font-mono text-[10px] text-faint">{m.dir === "req" ? "→ request" : "← response"}</div>
                  <pre className={clsx("font-mono text-[11.5px] leading-relaxed break-all whitespace-pre-wrap", m.status === "bad" ? "text-bad" : m.status === "ok" ? "text-ok" : "text-ink")}>{m.text}</pre>
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={() => setN((v) => Math.min(flow.length, v + 1))} disabled={n >= flow.length}>
              Next message
            </Button>
            <Button variant="ghost" onClick={() => setN(1)}>
              restart
            </Button>
          </div>
        </div>
        <div key={`${mode}-${n}`} className="animate-rise self-start rounded-xl border border-line bg-bg/50 p-4">
          <div className="font-mono text-xs text-accent">
            {n}/{flow.length}
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{cur.note}</p>
        </div>
      </div>
    </Panel>
  );
}

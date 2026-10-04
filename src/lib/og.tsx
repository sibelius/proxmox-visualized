import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metadata } from "next";
import { ImageResponse } from "next/og";
import { NAV } from "@/components/shell/nav";
import { Logo } from "@/components/shell/Logo";
import { HOME_BLURB, HOME_KICKER, HOME_TITLE, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./site";

export const OG_SIZE = { width: 1200, height: 630 };

const C = { bg: "#0a0c11", panel: "#11141b", line: "#242a38", ink: "#e7e9f0", muted: "#8a93a8", faint: "#5a6275" };
const ACCENTS = ["#e57000", "#a78bfa", "#38bdf8", "#34d399"];

function navItem(href: string) {
  const item = NAV.find((n) => n.href === href);
  if (!item) throw new Error(`No nav item for ${href}`);
  return item;
}

export function pageMetadata(href: string): Metadata {
  const item = navItem(href);
  const title = href === "/" ? SITE_NAME : `${item.label} · ${SITE_NAME}`;
  const description = href === "/" ? SITE_DESCRIPTION : `${item.blurb}. ${SITE_DESCRIPTION}`;
  return {
    title,
    description,
    openGraph: { title, description, url: href, siteName: SITE_NAME, type: href === "/" ? "website" : "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export function ogAlt(href: string) {
  if (href === "/") return `${SITE_NAME}: ${HOME_TITLE}`;
  const item = navItem(href);
  return `${item.label}: ${item.blurb}. ${SITE_NAME}`;
}

/** A row of hosts with guests, highlighted by page index. */
function Rack({ index, color }: { index: number; color: string }) {
  const hosts = 5;
  return (
    <div style={{ display: "flex", gap: 18 }}>
      {Array.from({ length: hosts }, (_, h) => {
        const hot = h === index % hosts;
        return (
          <div
            key={h}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              width: 198,
              padding: 12,
              borderRadius: 12,
              background: C.panel,
              border: `${hot ? 2 : 1.5}px solid ${hot ? color : C.line}`,
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              {Array.from({ length: 3 }, (_, g) => (
                <div
                  key={g}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 6,
                    background: hot && g === (index % 3) ? color : "#171b24",
                    border: `1px solid ${C.line}`,
                  }}
                />
              ))}
            </div>
            <div style={{ height: 10, borderRadius: 4, background: hot ? color : C.line, opacity: hot ? 0.7 : 1 }} />
          </div>
        );
      })}
    </div>
  );
}

const font = (f: string) => readFile(join(process.cwd(), "assets/fonts", f));

export async function renderOg(href: string) {
  const [semi, sans, mono] = await Promise.all([
    font("Inter-SemiBold.woff"),
    font("Inter-Regular.woff"),
    font("JetBrainsMono-Medium.woff"),
  ]);
  const home = href === "/";
  const item = navItem(href);
  const index = Number(item.n);
  const color = ACCENTS[index % ACCENTS.length];
  const title = home ? HOME_TITLE : item.label;
  const blurb = home ? HOME_BLURB : item.blurb;
  const titleSize = title.length > 40 ? 64 : title.length > 20 ? 84 : 100;
  const host = new URL(SITE_URL).host;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: C.bg,
          backgroundImage: `radial-gradient(circle at 95% 0%, ${color}24, transparent 42%)`,
          color: C.ink,
          padding: "54px 60px 44px",
          fontFamily: "Inter",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontFamily: "JetBrains Mono", fontSize: 24 }}>
          <div style={{ width: 4, height: 26, borderRadius: 2, background: color }} />
          <span style={{ color }}>{item.n}</span>
          <span style={{ color: C.muted }}>{home ? HOME_KICKER : item.group.toLowerCase()}</span>
        </div>
        <div style={{ marginTop: 30, fontWeight: 600, fontSize: titleSize, lineHeight: 1.08, letterSpacing: titleSize > 90 ? -4 : -2.5, maxWidth: 1080 }}>
          {title}
        </div>
        <div style={{ marginTop: 18, fontSize: 31, lineHeight: 1.35, color: C.muted, maxWidth: 1000 }}>{blurb}</div>
        <div style={{ flex: 1 }} />
        <Rack index={index} color={color} />
        <div
          style={{
            marginTop: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "JetBrains Mono",
            fontSize: 21,
            color: C.faint,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, color: C.ink }}>
            <Logo size={36} />
            <span style={{ fontFamily: "Inter", fontWeight: 600, fontSize: 24 }}>{SITE_NAME}</span>
          </div>
          <span>{host}</span>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Inter", data: semi, weight: 600, style: "normal" },
        { name: "Inter", data: sans, weight: 400, style: "normal" },
        { name: "JetBrains Mono", data: mono, weight: 500, style: "normal" },
      ],
    },
  );
}

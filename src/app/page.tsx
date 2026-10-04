import Link from "next/link";
import { StackHero } from "@/components/home/StackHero";
import { NAV } from "@/components/shell/nav";
import { pageMetadata } from "@/lib/og";
import { HOME_KICKER, HOME_TITLE, SITE_DESCRIPTION } from "@/lib/site";

export const metadata = pageMetadata("/");

export default function Home() {
  return (
    <div>
      <header className="max-w-3xl animate-rise">
        <div className="mb-3 font-mono text-xs text-accent">{HOME_KICKER}</div>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{HOME_TITLE}</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted text-pretty">{SITE_DESCRIPTION}</p>
      </header>

      <div className="mt-10 rounded-2xl border border-line bg-panel p-4 sm:p-6">
        <div className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">The stack, end to end</div>
        <StackHero />
      </div>

      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {NAV.filter((n) => n.href !== "/").map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group rounded-xl border border-line bg-panel p-5 transition hover:-translate-y-0.5 hover:border-faint"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-accent">{item.n}</span>
              <span className="text-faint transition group-hover:translate-x-0.5 group-hover:text-ink">→</span>
            </div>
            <div className="mt-3 font-medium">{item.label}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

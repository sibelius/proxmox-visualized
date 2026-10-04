import "server-only";
import { codeToHtml } from "shiki";
import clsx from "clsx";

/**
 * Highlighted code for SERVER components (pages). Pass the result as a prop/child
 * into client components when a demo needs to show highlighted code.
 */
export async function Code({
  code,
  lang = "bash",
  title,
  className,
}: {
  code: string;
  lang?: "bash" | "yaml" | "json" | "hcl" | "ini" | "go" | "ts" | "text" | "shell" | "toml";
  title?: string;
  className?: string;
}) {
  const html = await codeToHtml(code.trim(), { lang, theme: "github-dark-dimmed" });
  return (
    <div className={clsx("overflow-hidden rounded-xl border border-line bg-bg", className)}>
      {title && <div className="border-b border-line px-3 py-1.5 font-mono text-[11px] text-faint">{title}</div>}
      <div className="overflow-x-auto p-3 text-[12.5px] leading-relaxed [&_pre]:font-mono" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

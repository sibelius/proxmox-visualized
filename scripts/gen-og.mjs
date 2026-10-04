// Writes opengraph-image.tsx / twitter-image.tsx for every route in nav.ts.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
const nav = readFileSync("src/components/shell/nav.ts", "utf8");
const hrefs = [...nav.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
for (const href of hrefs) {
  const dir = href === "/" ? "src/app" : `src/app${href}`;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = `import { ogAlt, OG_SIZE, renderOg } from "@/lib/og";

export const alt = ogAlt("${href}");
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOg("${href}");
}
`;
  for (const f of ["opengraph-image.tsx", "twitter-image.tsx"]) writeFileSync(`${dir}/${f}`, body);
}
console.log(`OG images for ${hrefs.length} routes`);

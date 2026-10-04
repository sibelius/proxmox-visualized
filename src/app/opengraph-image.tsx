import { ogAlt, OG_SIZE, renderOg } from "@/lib/og";

export const alt = ogAlt("/");
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOg("/");
}

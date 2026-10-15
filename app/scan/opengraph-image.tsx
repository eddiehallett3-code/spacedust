import { getTool } from "@/lib/config/tools";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** The card a link to Wallet Scan renders as. Text comes from `TOOLS`. */
const tool = getTool("scan");

export const alt = `Spacedust — ${tool.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return ogCard({ title: tool.name, subtitle: tool.tagline });
}

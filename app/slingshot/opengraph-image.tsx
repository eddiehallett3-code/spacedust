import { getTool } from "@/lib/config/tools";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/**
 * The card a link to Slingshot renders as.
 *
 * Text and the tagline both come from `TOOLS`, so renaming a tool or rewriting its
 * one-line description updates the preview card in the same commit — the failure
 * this avoids is a card still advertising a name the site stopped using.
 */
const tool = getTool("slingshot");

export const alt = `Spacedust — ${tool.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return ogCard({ title: tool.name, subtitle: tool.tagline });
}

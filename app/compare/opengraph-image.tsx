import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** The card a link to the comparison renders as. */
export const alt = "Spacedust — comparing Solana wallet cleaners";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return ogCard({
    title: "Comparing wallet cleaners",
    subtitle: "Spacedust and Sol Incinerator, from their documentation and ours",
  });
}

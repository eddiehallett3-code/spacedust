import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** The card a link to the security page renders as. */
export const alt = "Spacedust — what is signed, stored and not stored";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return ogCard({
    title: "Security",
    subtitle: "What is signed, what is stored, and what never leaves your wallet",
  });
}

import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** The card a link to the explainer renders as. */
export const alt = "Spacedust — how each of the six tools works";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return ogCard({
    title: "How it works",
    subtitle: "What each of the six tools actually does, step by step",
  });
}

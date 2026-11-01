import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** The card a link to the privacy page renders as. */
export const alt = "Spacedust — what the app keeps and what it never sees";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return ogCard({
    title: "Privacy",
    subtitle: "What is kept, what is counted, and what is never collected",
  });
}

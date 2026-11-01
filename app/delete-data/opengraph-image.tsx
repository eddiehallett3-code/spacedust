import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** The card a link to the data-deletion page renders as. */
export const alt = "Spacedust — delete my data";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return ogCard({
    title: "Delete my data",
    subtitle: "How to have anything we hold removed, and what that covers",
  });
}

import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** The card a link to the terms renders as. */
export const alt = "Spacedust — terms of use";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return ogCard({
    title: "Terms",
    subtitle: "The agreement for using Spacedust, in plain language",
  });
}

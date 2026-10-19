import "server-only";

import { getSiteUrl } from "./site";

/**
 * Legal identity and contact details.
 *
 * Deliberately read from environment variables rather than typed into the
 * pages: a registered name, address or mailbox changes without the code
 * changing, and a privacy policy that names the wrong entity is worse than one
 * that is visibly unconfigured. The public values are safe to expose; none of
 * them is a credential.
 */
export const LEGAL_UPDATED = "18 October 2026";

/**
 * A contact must look like an email before it is rendered as a mailto link.
 * A typo here is worse than no link for the one control whose job is reachable.
 */
function contactEmail(value: string | undefined): string | null {
  const email = value?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export const LEGAL_ENTITY =
  process.env.LEGAL_ENTITY?.trim() ||
  process.env.NEXT_PUBLIC_LEGAL_ENTITY?.trim() ||
  "Spacedust";

export const LEGAL_EMAIL =
  contactEmail(process.env.LEGAL_EMAIL) ||
  contactEmail(process.env.NEXT_PUBLIC_LEGAL_EMAIL) ||
  contactEmail(process.env.NEXT_PUBLIC_SUPPORT_EMAIL);

export const LEGAL_ADDRESS =
  process.env.LEGAL_ADDRESS?.trim() ||
  process.env.NEXT_PUBLIC_LEGAL_ADDRESS?.trim() ||
  null;

export const LEGAL_JURISDICTION =
  process.env.LEGAL_JURISDICTION?.trim() ||
  process.env.NEXT_PUBLIC_LEGAL_JURISDICTION?.trim() ||
  "England and Wales";

export const LEGAL_SITE_URL = getSiteUrl();

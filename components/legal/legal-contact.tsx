import {
  LEGAL_ADDRESS,
  LEGAL_EMAIL,
  LEGAL_ENTITY,
} from "@/lib/config/legal";

/**
 * The controller/contact block used by every legal page.
 *
 * A monitored email is the required contact. A postal address is optional for
 * a hobby project; add a real service/trading address when operating as a sole
 * trader or company if consumer/trader rules require one. If the email is
 * missing, the block says so rather than inventing a mailbox.
 */
export function LegalContact() {
  return (
    <div
      id="contact"
      className="rounded-xl border border-border/60 bg-white/[0.02] p-4 text-sm leading-relaxed"
    >
      <p className="font-semibold text-foreground">{LEGAL_ENTITY}</p>
      {LEGAL_ADDRESS ? (
        <p className="mt-1 text-muted whitespace-pre-line">{LEGAL_ADDRESS}</p>
      ) : null}
      {LEGAL_EMAIL ? (
        <p className="mt-1">
          Email:{" "}
          <a href={`mailto:${LEGAL_EMAIL}`} className="text-violet-glow underline">
            {LEGAL_EMAIL}
          </a>
        </p>
      ) : (
        <p className="mt-1 text-warning">
          A monitored legal/privacy email is not configured yet.
        </p>
      )}
    </div>
  );
}

import {
  LEGAL_ADDRESS,
  LEGAL_EMAIL,
  LEGAL_ENTITY,
} from "@/lib/config/legal";

/**
 * The controller/contact block used by every legal page.
 *
 * It deliberately renders a visible “not configured” state instead of a guessed
 * mailbox or address. A legal page that invents a contact is worse than one that
 * tells the operator, before launch, that the contact still has to be supplied.
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
      ) : (
        <p className="mt-1 text-warning">
          Registered postal address is not configured yet.
        </p>
      )}
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

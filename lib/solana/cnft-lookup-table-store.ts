import { PublicKey } from "@solana/web3.js";
import { STORAGE_KEYS } from "@/lib/utils/constants";

/**
 * Pending lookup-table rent, persisted across reloads.
 *
 * A lookup table is created before the burn and cannot be closed for 512 slots
 * after deactivation. The table address is the only handle to its rent, so
 * keeping it only in React state means a refresh during that wait strands the
 * rent permanently. This store is deliberately tiny and unprivileged: every
 * address in it is a table whose authority is the wallet that created it, and a
 * close still requires that wallet's signature.
 */

export interface PendingLookupTable {
  address: string;
  /** Last observed balance, for display only. The chain is authoritative. */
  rentLamports: number;
}

export interface PendingLookupTableCleanup {
  authority: string;
  tables: PendingLookupTable[];
  createdAt: number;
}

function isPendingTable(value: unknown): value is PendingLookupTable {
  if (typeof value !== "object" || value === null) return false;
  const table = value as Partial<PendingLookupTable>;
  if (typeof table.address !== "string") return false;
  if (
    typeof table.rentLamports !== "number" ||
    !Number.isFinite(table.rentLamports) ||
    table.rentLamports < 0
  ) {
    return false;
  }
  try {
    new PublicKey(table.address);
    return true;
  } catch {
    return false;
  }
}

function isPendingCleanup(value: unknown): value is PendingLookupTableCleanup {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<PendingLookupTableCleanup>;
  return (
    typeof entry.authority === "string" &&
    typeof entry.createdAt === "number" &&
    Array.isArray(entry.tables) &&
    entry.tables.every(isPendingTable)
  );
}

function readAll(): PendingLookupTableCleanup[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.lookupTableCleanup);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPendingCleanup) : [];
  } catch {
    // Private browsing, corrupt JSON, or storage disabled. An empty list is the
    // safe answer; a current run still holds its tables in memory.
    return [];
  }
}

function writeAll(entries: PendingLookupTableCleanup[]): void {
  if (typeof window === "undefined") return;
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(STORAGE_KEYS.lookupTableCleanup);
      return;
    }
    window.localStorage.setItem(
      STORAGE_KEYS.lookupTableCleanup,
      JSON.stringify(entries),
    );
  } catch {
    // Storage full or unavailable. The in-memory flow still works.
  }
}

/** Pending tables for one wallet, newest first. */
export function listPendingLookupTableCleanups(
  authority: string,
): PendingLookupTable[] {
  return readAll()
    .filter((entry) => entry.authority === authority)
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((entry) => entry.tables);
}

/** Remember tables whose rent has not been returned yet. */
export function rememberPendingLookupTableCleanup(
  authority: string,
  tables: PendingLookupTable[],
): void {
  if (tables.length === 0) return;

  const entries = readAll();
  const existing = entries.find((entry) => entry.authority === authority);
  const merged = new Map<string, PendingLookupTable>();

  for (const table of existing?.tables ?? []) merged.set(table.address, table);
  // New readings win, because they are the most recent balance.
  for (const table of tables) merged.set(table.address, table);

  const next: PendingLookupTableCleanup = {
    authority,
    tables: [...merged.values()],
    createdAt: Date.now(),
  };

  writeAll([
    next,
    ...entries.filter((entry) => entry.authority !== authority),
  ]);
}

/** Drop tables that have been closed; remove the wallet entry when none remain. */
export function forgetPendingLookupTableCleanup(
  authority: string,
  tableAddresses: string[],
): void {
  if (tableAddresses.length === 0) return;
  const closed = new Set(tableAddresses);
  const entries = readAll();
  const next = entries.flatMap((entry) => {
    if (entry.authority !== authority) return [entry];
    const tables = entry.tables.filter((table) => !closed.has(table.address));
    return tables.length === 0 ? [] : [{ ...entry, tables }];
  });
  writeAll(next);
}

import "server-only";

import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import {
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import { classifyTransferHook } from "./hook-tokens";
import type { HookTokenFacts } from "@/types/token";

/**
 * Read the transfer-hook extension off each mint, for real.
 *
 * The scanner only tells us a mint *has* the extension. What decides whether a
 * holding is stuck or merely mis-routed is the extension's program id — and
 * that is a mint-account field, not an account field, so it has to be read from
 * the mint. `@solana/spl-token`'s own `unpackMint` + `getTransferHook` do the
 * TLV parsing, so we are not hand-slicing bytes at guessed offsets.
 *
 * Batched, one `getMultipleAccountsInfo` per 100 mints, because this runs on
 * top of an already-expensive scan. A failed batch is not fatal: those mints
 * land as `unknown` and nothing downstream will act on them.
 */

/** Mints per `getMultipleAccountsInfo` call. The RPC caps this at 100. */
const MINT_BATCH = 100;

export async function readHookFacts(
  connection: Connection,
  mints: readonly string[],
  frozenByMint: ReadonlyMap<string, boolean>,
): Promise<Map<string, HookTokenFacts>> {
  const out = new Map<string, HookTokenFacts>();
  const unique = Array.from(new Set(mints));
  if (unique.length === 0) return out;

  for (let index = 0; index < unique.length; index += MINT_BATCH) {
    const batch = unique.slice(index, index + MINT_BATCH);

    let infos: Array<AccountInfo<Buffer> | null>;
    try {
      infos = await connection.getMultipleAccountsInfo(
        batch.map((mint) => new PublicKey(mint)),
      );
    } catch {
      infos = batch.map(() => null);
    }

    batch.forEach((mint, offset) => {
      const info = infos[offset] ?? null;
      const frozen = frozenByMint.get(mint) ?? false;

      // Not read: we say so rather than guess.
      if (!info) {
        out.set(mint, {
          mint,
          program: "token2022",
          hookProgram: null,
          hookAuthority: null,
          verdict: classifyTransferHook({
            hookProgram: null,
            frozen,
            readable: false,
          }),
        });
        return;
      }

      // Only Token-2022 mints carry extensions. A legacy mint flagged by the
      // scanner is a naming collision, not a hook.
      if (!info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
        out.set(mint, {
          mint,
          program: "legacy",
          hookProgram: null,
          hookAuthority: null,
          verdict: classifyTransferHook({
            hookProgram: null,
            frozen,
            readable: false,
          }),
        });
        return;
      }

      let hookProgram: string | null = null;
      let hookAuthority: string | null = null;
      try {
        const parsed = unpackMint(
          new PublicKey(mint),
          info,
          TOKEN_2022_PROGRAM_ID,
        );
        const hook = getTransferHook(parsed);
        if (hook) {
          hookProgram = hook.programId.toBase58();
          hookAuthority = hook.authority.toBase58();
        }
      } catch {
        // Unparseable mint: leave both null, which reads as `inert` unless
        // frozen. Nothing downstream acts on an `inert` token but The Void,
        // and The Void re-reads the account before it burns anything.
      }

      out.set(mint, {
        mint,
        program: "token2022",
        hookProgram,
        hookAuthority,
        verdict: classifyTransferHook({ hookProgram, frozen }),
      });
    });
  }

  return out;
}

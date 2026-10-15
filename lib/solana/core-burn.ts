import type { TransactionInstruction } from "@solana/web3.js";
import { programRepositoryShim } from "@/lib/solana/umi-program-repository";

/**
 * Burning a Metaplex Core asset.
 *
 * A Core asset is not an SPL token. It is a single account owned by the Core
 * program, so there is no token account to burn and close. It needs a
 * Core-specific instruction, and the failure mode of getting one wrong is not
 * "the burn fails" but "the bytes mean something else entirely".
 *
 * A Core burn returns most of the account's rent, but it does **not** close the
 * account: the program shrinks it to a single zero byte. Verified by simulating
 * a real burn against a real mainnet asset and reading the account afterwards —
 * 1,788,160 lamports became 655,320 with one byte of data, and the Core program
 * exposes no instruction that would close what is left (`probes/tmp-core-husk.mjs`).
 * So the residue is stranded, and this is why `rent.ts` prices a husk and
 * `liveness.ts` recognises one: the rent that does not come back must not be
 * quoted as if it did.
 *
 * So we do not encode it ourselves. We call mpl-core's own `burnV1` builder,
 * which owns the discriminator, the argument encoding and the account list, and
 * convert the result with Metaplex's own web3.js adapter — so it drops into the
 * existing pack → simulate → sign pipeline as a plain instruction, with no umi
 * runtime, no wallet, and no signing path of its own.
 *
 * The packages are imported dynamically on purpose: they exist only for this,
 * so a user who never burns a Core asset never downloads them.
 */
export interface CoreBurnRequest {
  /** The asset account (DAS `id`). */
  asset: string;
  /** Its collection, when it has one — Core requires the account. */
  collection: string | null;
  /** The wallet that owns the asset and will sign. */
  owner: string;
}

export async function buildCoreBurnInstruction(
  request: CoreBurnRequest,
): Promise<TransactionInstruction> {
  const [umi, core, adapters] = await Promise.all([
    import("@metaplex-foundation/umi"),
    import("@metaplex-foundation/mpl-core"),
    import("@metaplex-foundation/umi-web3js-adapters"),
  ]);

  const context = umi.createUmi();
  (context as unknown as { programs: unknown }).programs = programRepositoryShim();
  context.use(core.mplCore());

  // Noop signers: we are building an instruction, not signing. The authority is
  // still a signer *slot*, which the packer turns into a wallet approval later.
  const owner = umi.createNoopSigner(umi.publicKey(request.owner));
  const builder = core.burnV1(context, {
    asset: umi.publicKey(request.asset),
    ...(request.collection
      ? { collection: umi.publicKey(request.collection) }
      : {}),
    authority: owner,
    payer: owner,
  });

  const [instruction] = builder.getInstructions();
  if (!instruction) {
    throw new Error("mpl-core built no instruction for this asset.");
  }
  return adapters.toWeb3JsInstruction(instruction);
}


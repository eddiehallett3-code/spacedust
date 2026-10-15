/**
 * The only part of a umi program repository these burn builders touch.
 *
 * mpl-core's `burnV1` resolves its program as
 * `programs.getPublicKey('mplCore', '<core program id>')` — asking for the
 * address, and passing that address itself as the fallback. mpl-bubblegum's
 * `burn` asks the same way, for four names: `mplBubblegum`, `splNoop`,
 * `splAccountCompression` and `splSystem`.
 *
 * `umi-bundle-defaults` normally supplies a full repository, but that package
 * also carries an uploader and an HTTP client we would never use, to build one
 * instruction.
 *
 * `getPublicKey` throws when it is given no fallback, rather than returning
 * `undefined`. An `undefined` program id does not fail here — it becomes an
 * instruction with no program, and the failure surfaces later as something
 * unrecognisable. Verified against both builders' emitted source: every call
 * they make passes a fallback.
 */
export function programRepositoryShim(): unknown {
  return {
    add: () => {},
    getPublicKey: (name: string, fallback?: string) => {
      if (!fallback) {
        throw new Error(
          `No address is known for the umi program "${name}", and it was asked for without a fallback.`,
        );
      }
      return fallback;
    },
  };
}

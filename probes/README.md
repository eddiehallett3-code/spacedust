# Probes

Read-only scripts that measure one thing against mainnet, kept because the README
cites what they found. A measurement whose script was deleted is a claim you have
to take on trust, and the numbers in the README are meant to be re-checkable —
which is the entire reason these exist.

```bash
node probes/tmp-<name>.mjs      # from the repository root: they read .env.local
```

Every one is safe to run. They read chain data, build instructions to inspect
them, and simulate; none of them signs, sends, or holds a key. Each file opens
with a comment saying what it measures and what the answer turned out to be.

They are deliberately **not** part of the build or the test suite — several make
dozens of RPC calls and take minutes. `npm test` runs the invariants; these answer
one-off questions that were worth answering once and then writing down.

The directory exists rather than the root because they used to sit beside
`package.json`, where twenty-six scripts named `tmp-*` read as the project's
actual source. Moving them here left every reference in the README and the code
comments intact and pointing at a real file.

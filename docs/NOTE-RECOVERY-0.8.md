# Diversified Note recipient recovery

A Note's receiver may be a diversified address of the same privacy account. Passing the account's default `own_raw_address_hex` to `scan` replaces `recipient_raw_address_hex`, even though the decrypted `d_hex` and `pkd_hex` still describe the original receiver. Amount discovery succeeds but witness reconstruction computes a different commitment, producing `cm_matches_stored=false` and a Merkle-path-inconsistent error.

The scanner now preserves the receiver recovered from ciphertext. Existing encrypted Note caches and imported Notes are normalized from their own 11-byte diversifier plus 32-byte receiver. Other opening fields and the stored commitment stay intact. Repaired Notes get fresh nullifiers and authoritative spent checks before being saved or selected for proving. Cached Notes are repaired even when their scan cursor is already at the chain head. Merkle roots, anchors, commitment existence and spent checks remain required.

`pnpm test:note-recovery` uses an unfunded test seed and a synthetic tree with the selected Note at position 4905. It reproduces the failure with the old address override, verifies normal and diversified Note recovery, and generates a complete Groth16 `prove_note` result from the repaired Note. It calls the production normalization helper. Protocol-specific nonzero-psi VNotes continue to require their separate recovery openings; they are not force-imported by the ordinary scanner.

The test never reads the user's vault or broadcasts a transaction.

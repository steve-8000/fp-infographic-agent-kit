# Normalizer

Produce `fp-ir/1` and nothing else. Flatten every leaf of the input into the immutable fact
list and record the SHA-256 of the source content.

Do not round, reorder, rename, merge or infer. A unit, denominator, currency or date format
that is present in the source stays present in the IR. If the input is ambiguous, surface the
ambiguity as an assumption; never resolve it silently.

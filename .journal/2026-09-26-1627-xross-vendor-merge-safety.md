# Xross vendor merge safety boundary

The combined Refyard branch takes the Xross UI worktree and the Rust host
facade as one vendor revision. Before the merge commit, a GPT-6 Sol medium
review of the staged tree found two P1 issues and three P2 UI issues.

The surprising P1 was outside Xross: the incoming DeepSeek Harness plugin
could approve any caller-named repository and mint a full-scope pairing ticket
through unauthenticated loopback HTTP. Origin checks block cross-site browser
requests but do not authenticate a local process; the available local Harness
sample did not expose a verifiable authenticated route contract. I considered
adding a guessed `host.call` handshake or relying on loopback. Both would turn
an unknown security property into a product promise. The Xross vendor merge
therefore excludes only that plugin and its build entry. Its original feature
branch remains available for a separate secure integration once the actual
Harness authority boundary is verified.

The second P1 was a wrong-target selection: single-repository mode used the
first known repository if its requested ID/path was absent. That can put write
controls on a different session's repository. Selection now fails closed and
has focused tests for ID mismatch, path alias, and missing pin. This fix stays
in the vendor branch because single mode is also relevant to embedded UIs.

The P2 UI findings are recorded in `docs/review-followups.md` for a grouped
repair pass. This commit does not claim real-device or distributed Xross proof;
the Refyard library and Xross service must still pass the later integration
and CI gates.

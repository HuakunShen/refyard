# Keep the Windows target failure observable

The first fixture repair replaced Unix `/dev/null` with an isolated Git config
path. A new exact-head Windows embed run still failed the same two status reads
with exit 2. That disproves the repair as a complete explanation; it may still
be a worthwhile portability fix, but no more semantic changes should be made
from that hypothesis alone.

The service's structured `GitCommandFailed` problem reports the command and
exit code but intentionally omits raw child stderr. I considered changing the
production problem to expose stderr, which would be a privacy and contract
change just for a test. Instead, these two test assertions now make a second
direct scripted-SSH status call only on failure and include its full
`RunOutcome` in the test panic. This uses the same target program, environment,
remote path and Git plan. It adds no output on success and does not weaken
either assertion. Both focused tests and Windows-target strict Clippy pass
locally; the next hosted Windows run must reveal the real refusal bytes.

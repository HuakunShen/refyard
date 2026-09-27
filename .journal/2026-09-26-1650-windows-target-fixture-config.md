# Windows target fixture uses its own Git config

The exact-head Windows embed job passed the host contract tests until
`tests/targets.rs`, where two scripted-target reads failed with Git status exit
2. The scripted child is a native Rust executable that inherits the fixture's
explicit environment. That environment named `/dev/null` as
`GIT_CONFIG_GLOBAL`, even though the fixture already creates an empty
`home/.gitconfig`. `/dev/null` is a Unix device path, not a reliable path for
native Windows Git after the additional process boundary.

The fix points `GIT_CONFIG_GLOBAL` at the fixture's existing empty config file
on every platform. I considered weakening the assertions or relying on Git's
ambient global configuration; both would hide the isolation error. The same
two target-routing tests pass locally, Windows-target strict Clippy passes,
and the diff is whitespace-clean. A new hosted Windows run is still required
to confirm the hypothesized cause; local macOS results are not Windows proof.

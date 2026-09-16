# Performance evidence

The machine-readable benchmark report is [performance.json](/Volumes/Portable2TB/ExtDev/refyard/docs/evidence/performance.json).
It is the canonical report: `bench:runtime` rewrites it with the runtime, platform, artifact,
fixture, methodology and measured values for the machine on which the command ran. The release
matrix links its summary to this file rather than duplicating measurements in prose.

The current committed report is a short repeated macOS arm64 run, not a soak test and not evidence
for another platform. Numbers from another machine must not be copied into this file without the
report's runtime and platform fields changing with them.

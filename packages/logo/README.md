# Refyard logo assets

This directory contains source SVG variants for design reference only. It is intentionally not a
workspace package and is not imported by the product: the deployable SPA owns the copies in
`apps/web/static/`, where the build and PWA asset graph can version them together.

If the product adopts one of these variants, copy the selected source into the web app and update
the web asset tests in the same change; do not add a runtime dependency on this un-packaged folder.

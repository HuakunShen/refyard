/** Facade-specific presentation values that never invent legacy Git fields. */
import { parseUInt64V1 } from "../../../../../integrations/xross/view-contract/contracts/view-v1/types.js";
import type { RemoteEndpointSummaryV1 } from "../../../../../integrations/xross/view-contract/contracts/view-v1/types.js";
import { hostOnlyRemoteSummary } from "@refyard/git-ui/lib/xross-presentation";
import { createGitViewI18n } from "@refyard/git-ui/lib/i18n/catalog";

/** Date's inclusive bound; anything larger cannot be rendered faithfully by JS Date. */
const MAX_DATE_MILLIS = 8_640_000_000_000_000n;

export function checkedUnixMillis(value: string): number | null {
  if (parseUInt64V1(value) === null) return null;
  const exact = BigInt(value);
  return exact <= MAX_DATE_MILLIS ? Number(exact) : null;
}

export function remoteEndpointLabel(endpoint: RemoteEndpointSummaryV1, locale = "en"): string {
  const { t } = createGitViewI18n(locale);
  return hostOnlyRemoteSummary(endpoint, {
    redacted: t("xross.remote.redacted"),
    hostOnly: t("xross.remote.hostOnly"),
  });
}

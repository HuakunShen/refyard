/** Shared source-faithful labels for the Xross Refyard Git presentation. */
export type XrossRemoteSummary =
  | { readonly kind: "redacted" }
  | { readonly kind: "network"; readonly transport: "https" | "http" | "ssh" | "git"; readonly hostDisplay: string };

export function hostOnlyRemoteSummary(value: XrossRemoteSummary, labels: {
  readonly redacted: string;
  readonly hostOnly: string;
} = {
  redacted: "Host-only endpoint redacted",
  hostOnly: "Host-only endpoint summary; complete URL not provided",
}): string {
  return value.kind === "redacted" ? labels.redacted :
    `${value.transport}: ${value.hostDisplay} (${labels.hostOnly})`;
}

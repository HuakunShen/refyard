/** Presentation-only history drafts and known choices; applied Git intentions belong to the host app. */
export interface KnownHistoryPath {
  readonly pathId: string;
  readonly displayPath: string;
}
export interface HistoryFilterDraft {
  message: string;
  author: string;
  oidPrefix: string;
  refFullName: string;
  committedAfter: string;
  committedBefore: string;
  path: KnownHistoryPath | null;
}

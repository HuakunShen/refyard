/**
 * The message contract between the extension host and the workbench webview.
 *
 * The webview never sees a bearer token, a URL, or `fetch`: it names a read, and the
 * host — the only side that talks to the local service — answers with the contract's
 * DTO or with the service's own problem. Shared by both sides so the two ends of the
 * bridge cannot drift apart.
 */
import type {
  DiffResponse,
  HistoryPage,
  RepositoriesResponse,
  StatusSnapshot,
} from "@refyard/git-contract";

export interface WorkbenchInit {
  readonly kind: "init";
  readonly dark: boolean;
  readonly repositoryName: string;
  readonly repositoryId: string;
}

export type WorkbenchRequest =
  | { readonly kind: "status" }
  | {
      readonly kind: "history";
      readonly cursor?: string | null;
    }
  | {
      readonly kind: "diff";
      readonly diffKind: "unstaged" | "staged" | "untracked" | "commit";
      readonly pathId?: string;
      readonly oid?: string;
    };

export type WorkbenchAnswer =
  | { readonly kind: "status"; readonly snapshot: StatusSnapshot }
  | { readonly kind: "repositories"; readonly answer: RepositoriesResponse }
  | { readonly kind: "history"; readonly page: HistoryPage }
  | { readonly kind: "diff"; readonly diff: DiffResponse };

export interface BridgeRequest {
  readonly id: number;
  readonly payload: WorkbenchRequest;
}

export type BridgeAnswer =
  | {
      readonly id: number;
      readonly ok: true;
      readonly answer: WorkbenchAnswer;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly problem: { code: string; message: string };
    };

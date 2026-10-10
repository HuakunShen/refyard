/**
 * GitKraken-style session restore: the repository tabs a session had open come back
 * when the app starts, so nobody has to go looking through the recent list.
 *
 * Only *paths* are persisted, never repository ids — the host mints fresh ids every
 * process start, so a stored id would name a repository that no longer exists. On
 * boot the saved paths are re-registered (registration is idempotent by location) and
 * the summaries that come back are mapped onto fresh tabs, preserving the saved order
 * and the saved active tab. A path that fails to register — moved, deleted, or on a
 * host that is not connected — is skipped rather than guessed at; it stays in the
 * recent list where the launcher can still reach it.
 *
 * Pure state in and out: the page owns the storage, the registration calls and the
 * tab store, and this module only decides what is worth saving and what a restore
 * means.
 */

import type { RepositorySummary } from "@refyard/git-contract";
import type { RepositoryTab } from "./repository-tabs.js";
import { repositoryTabKey } from "./repository-tabs.js";

/** `refyard.session.tabs` — the open-tab set, written whenever it changes. */
export const SESSION_TABS_KEY = "refyard.session.tabs";

/** One persisted tab: the location it was opened at, plus whether it was active. */
export interface SavedSessionTab {
  readonly displayPath: string;
  /**
   * The target the tab was opened on, when known. Only local tabs are restored this
   * session; a saved SSH target is recorded but restore skips it, because targets are
   * minted per process and re-creating one is a flow, not a lookup.
   */
  readonly targetId?: string;
  readonly active?: boolean;
}

export interface SavedSession {
  readonly tabs: readonly SavedSessionTab[];
  readonly savedAt: string;
}

/**
 * Read the saved session. A missing, malformed or empty entry reads as "nothing to
 * restore" rather than an error — the launcher taking over is the normal answer.
 */
export function loadSessionTabs(
  storage: Pick<Storage, "getItem">,
): SavedSession | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SESSION_TABS_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const tabs = Reflect.get(parsed, "tabs");
  if (!Array.isArray(tabs)) return null;
  const saved: SavedSessionTab[] = [];
  for (const entry of tabs) {
    if (typeof entry !== "object" || entry === null) continue;
    const displayPath = Reflect.get(entry, "displayPath");
    if (typeof displayPath !== "string" || displayPath.length === 0) continue;
    const targetId = Reflect.get(entry, "targetId");
    const active = Reflect.get(entry, "active");
    saved.push({
      displayPath,
      ...(typeof targetId === "string" ? { targetId } : {}),
      ...(active === true ? { active: true } : {}),
    });
  }
  if (saved.length === 0) return null;
  const savedAt = Reflect.get(parsed, "savedAt");
  return {
    tabs: saved,
    savedAt: typeof savedAt === "string" ? savedAt : "",
  };
}

/** Write the open-tab set. Local-only: remote-target tabs are not restored yet. */
export function saveSessionTabs(
  storage: Pick<Storage, "setItem">,
  tabs: readonly RepositoryTab[],
  activeRepositoryId: string | null,
): void {
  const saved: SavedSessionTab[] = tabs.map((tab) => ({
    displayPath: tab.displayPath,
    ...(tab.targetId !== undefined ? { targetId: tab.targetId } : {}),
    ...(activeRepositoryId !== null &&
    repositoryTabKey(tab) === activeRepositoryId
      ? { active: true }
      : {}),
  }));
  const session: SavedSession = {
    tabs: saved,
    savedAt: new Date().toISOString(),
  };
  try {
    storage.setItem(SESSION_TABS_KEY, JSON.stringify(session));
  } catch {
    // A full or blocked store loses the next restore, not any repository state.
  }
}

/**
 * Map saved tabs onto the summaries a restore's registrations produced.
 *
 * `registered` is keyed by the path each registration was asked for. The result
 * preserves the saved order, carries the summary's fresh id and display name, and
 * activates the saved active tab — or the first restored tab when the saved active
 * one failed to come back. Tabs skipped by the restore are simply absent.
 *
 * Restored tabs are default tabs: they carry no `worktreeId`, exactly like the
 * tabs `tabForRepository` builds for a fresh open. The primary worktree is the
 * null worktree selection resolving to `primaryWorktreeId`, so pinning the primary
 * id onto the tab would mint a second identity (`repo:wt`) for the same view as
 * the default tab (`repo`) — and every later open would land beside it as a
 * visible duplicate.
 */
export function tabsFromRestore(
  saved: readonly SavedSessionTab[],
  registered: ReadonlyMap<string, RepositorySummary>,
): { tabs: RepositoryTab[]; activeRepositoryId: string | null } {
  const tabs: RepositoryTab[] = [];
  let savedActive: string | null = null;
  for (const entry of saved) {
    const summary = registered.get(entry.displayPath);
    if (summary === undefined) continue;
    const tab: RepositoryTab = {
      repositoryId: summary.repositoryId,
      ...(summary.targetId !== undefined
        ? { targetId: summary.targetId }
        : entry.targetId !== undefined
          ? { targetId: entry.targetId }
          : {}),
      displayName: summary.displayName,
      displayPath: summary.displayPath,
    };
    const key = repositoryTabKey(tab);
    if (tabs.some((existing) => repositoryTabKey(existing) === key)) continue;
    if (entry.active === true && savedActive === null) {
      savedActive = key;
    }
    tabs.push(tab);
  }
  return {
    tabs,
    activeRepositoryId:
      savedActive ?? (tabs[0] === undefined ? null : repositoryTabKey(tabs[0])),
  };
}

/** The slice of the read service a restore needs — a fake stands in for it in tests. */
export interface RestoreService {
  repositories(): Promise<{ repositories: readonly RepositorySummary[] }>;
  registerRepository(
    path: string,
  ): Promise<{ repositories: readonly RepositorySummary[] }>;
}

/**
 * Run a restore: for each saved local tab, find its summary — already registered
 * (a service that outlived the page), or registered now (a host that started fresh)
 * — and map everything that came back onto fresh tabs.
 *
 * Each saved entry resolves independently: one repository that moved, or one target
 * that will not re-mint, costs itself alone. Local tabs only; an entry carrying a
 * remote target needs that target re-created first, which is a flow, not a lookup.
 */
export async function restoreSessionTabs(
  saved: readonly SavedSessionTab[],
  service: RestoreService,
): Promise<{ tabs: RepositoryTab[]; activeRepositoryId: string | null }> {
  const registered = new Map<string, RepositorySummary>();
  for (const entry of saved) {
    if (entry.targetId !== undefined && entry.targetId !== "tgt_local") {
      continue;
    }
    // The service may have outlived the page (an HTTP reload): the repository is
    // already registered and re-registering it would be refused as a conflict, so
    // the list answers first.
    const listed = await findInList(service, entry.displayPath);
    if (listed !== undefined) {
      registered.set(entry.displayPath, listed);
      continue;
    }
    try {
      const result = await service.registerRepository(entry.displayPath);
      const added =
        result.repositories.find((row) => row.displayPath === entry.displayPath);
      if (added !== undefined) {
        registered.set(entry.displayPath, added);
      }
    } catch {
      // A refused registration — moved, deleted, unavailable — costs this tab only.
      // The recent list still knows where the path went.
    }
  }
  return tabsFromRestore(saved, registered);
}

async function findInList(
  service: RestoreService,
  displayPath: string,
): Promise<RepositorySummary | undefined> {
  try {
    const list = await service.repositories();
    return list.repositories.find((row) => row.displayPath === displayPath);
  } catch {
    return undefined;
  }
}

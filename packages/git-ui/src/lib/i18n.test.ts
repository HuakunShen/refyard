/** Catalog parity and locale formatting for the embedded Git view. */
import { describe, expect, it } from "vitest";
import { catalogs, createGitViewI18n, selectGitViewLocale } from "./i18n/catalog.js";

describe("Git view translations", () => {
  it("keeps all five checked-in catalogs keyed and nonempty", () => {
    const english = Object.keys(catalogs.en).sort();
    for (const catalog of Object.values(catalogs)) {
      expect(Object.keys(catalog).sort()).toEqual(english);
      expect(Object.values(catalog).every((value) => value.trim().length > 0)).toBe(true);
    }
  });

  it("selects the exact host locale and defaults standalone UI to English", () => {
    expect(selectGitViewLocale("zh-Hans")).toBe("zh-Hans");
    expect(selectGitViewLocale("zh-CN")).toBe("zh-Hans");
    expect(selectGitViewLocale("ja-JP")).toBe("ja");
    expect(selectGitViewLocale("es-MX")).toBe("es");
    expect(selectGitViewLocale("fr-CA")).toBe("fr");
    expect(selectGitViewLocale(undefined)).toBe("en");
    expect(createGitViewI18n("ja").t("xross.page.more")).toBe("次のページを読み込む");
  });

  it("formats counts, relative time, exact time and bytes with Intl", () => {
    const i18n = createGitViewI18n("fr");
    expect(i18n.count(1234)).toBe(new Intl.NumberFormat("fr").format(1234));
    expect(i18n.relativeTime("1710000000000", 1710000000000 + 60_000)).toBe(new Intl.RelativeTimeFormat("fr", { numeric: "auto" }).format(-1, "minute"));
    expect(i18n.absoluteTime("1710000000000")).toContain("2024");
    expect(i18n.bytes("2048")).toContain("KiB");
    expect(i18n.absoluteTime("18446744073709551615")).toBe(i18n.t("xross.time.invalid"));
    expect(i18n.absoluteIso("2024-03-09T16:00:00.000Z")).toContain("2024");
    expect(i18n.relativeIso("2024-03-09T16:00:00.000Z", Date.parse("2024-03-09T16:01:00.000Z")))
      .toBe(new Intl.RelativeTimeFormat("fr", { numeric: "auto" }).format(-1, "minute"));
    expect(createGitViewI18n("en").paths(1)).toBe("1 path");
    expect(createGitViewI18n("en").paths(2)).toBe("2 paths");
    expect(createGitViewI18n("zh-Hans").paths(2)).toBe("2 条路径");
    expect(createGitViewI18n("en").worktrees(2)).toBe("2 worktrees");
  });

  it("localizes built-in Git states without changing source-owned names", () => {
    const i18n = createGitViewI18n("zh-Hans");
    expect(i18n.head({ kind: "unborn", branchName: "main", oid: null, detached: false })).toBe("尚无提交");
    expect(i18n.head({ kind: "born", branchName: "feature/e\u0301", oid: "1".repeat(40), detached: false })).toBe("feature/e\u0301");
    expect(i18n.statusLetter("M")).toBe("已修改");
    expect(i18n.statusLetter("?")).toBe("未跟踪");
  });

  it("localizes working-copy controls and leaves supplied paths intact", () => {
    const fr = createGitViewI18n("fr");
    expect(fr.t("working.unstagedFiles")).toBe("Fichiers non indexés");
    expect(fr.t("working.stageAll")).toBe("Tout indexer");
    expect(fr.t("working.discardQuestion").replace("{path}", () => "a/$&.txt"))
      .toBe("Abandonner a/$&.txt ?");
    expect(createGitViewI18n("ja").t("working.resolveFirst"))
      .toBe("先に競合を解決してください");
  });

  it("localizes repository entry controls without translating target names", () => {
    const es = createGitViewI18n("es");
    expect(es.t("launcher.repositories")).toBe("Repositorios");
    expect(es.t("launcher.openRepository")).toBe("Abrir repositorio");
    expect(es.t("launcher.remoteBrowseUnavailable").replace("{target}", () => "ssh/$&"))
      .toContain("ssh/$&");
  });

  it("localizes history controls while preserving source-owned refs and subjects", () => {
    const ja = createGitViewI18n("ja");
    expect(ja.t("history.column.refs")).toBe("ブランチ / タグ");
    expect(ja.t("history.action.createBranch")).toBe("ここにブランチを作成…");
    expect(ja.t("history.deleteQuestion").replace("{name}", () => "refs/$&"))
      .toContain("refs/$&");
    expect(ja.absoluteIso("2024-03-09T16:00:00.000Z")).toContain("2024");
  });

  it("localizes shared dialog close affordances", () => {
    expect(createGitViewI18n("zh-Hans").t("dialog.close")).toBe("关闭");
  });

  it("routes illustrative placeholders through every checked catalog", () => {
    const examples = ["tag.nameExample", "remote.nameExample", "submodule.pathExample",
      "connection.addressExample", "connection.ticketExample"] as const;
    for (const locale of ["en", "zh-Hans", "ja", "es", "fr"] as const) {
      const { t } = createGitViewI18n(locale);
      for (const example of examples) expect(t(example).length).toBeGreaterThan(0);
    }
  });

  it("localizes typed Xross state values without collapsing distinct states", () => {
    const fr = createGitViewI18n("fr");
    expect(fr.t("xross.recovery.state.found")).toBe("Tâche retrouvée");
    expect(fr.t("xross.recovery.state.ownerAcceptedUnknown"))
      .not.toBe(fr.t("xross.recovery.state.reconciled"));
    expect(fr.t("xross.job.state.needsAttention")).toBe("Intervention requise");
    expect(fr.t("xross.diff.patch.oversize")).toBe("Correctif trop volumineux");
    expect(createGitViewI18n("zh-Hans").t("xross.host.macos")).toBe("macOS");
    expect(createGitViewI18n("zh-Hans").t("xross.host.unknown"))
      .not.toBe(createGitViewI18n("zh-Hans").t("xross.host.macos"));
  });

  it("distinguishes a truncated result with no continuation cursor", () => {
    expect(createGitViewI18n("en").t("xross.page.truncatedNoCursor"))
      .toBe("Results were truncated, but the host did not provide a continuation cursor.");
  });
});

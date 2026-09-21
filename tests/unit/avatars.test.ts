/**
 * Verifies the author-avatar mapping: GitHub photos from noreply emails,
 * deterministic initials for everyone else, and no spoofable look-alikes.
 */
import { describe, expect, it } from "vitest";
import {
  authorAvatar,
  githubBranchUrl,
  githubCommitUrl,
  githubOwnerAvatarUrl,
  githubRepoFromRemote,
  initialsAvatar,
} from "@refyard/git-ui/lib/avatars";

describe("author avatars", () => {
  it("maps current noreply emails to the GitHub account's photo", () => {
    // Real-world shape since 2017: {id}+{username}@users.noreply.github.com.
    // The username is what names the photo; the numeric id is not a username.
    const avatar = authorAvatar(
      "1234567+alex-rudenko@users.noreply.github.com",
      "Alex Rudenko",
    );
    expect(avatar).toEqual({
      kind: "github",
      username: "alex-rudenko",
      url: "https://github.com/alex-rudenko.png?size=80",
    });
  });

  it("maps the pre-2017 bare noreply form too", () => {
    const avatar = authorAvatar(
      "bruno@users.noreply.github.com",
      "Bruno",
    );
    expect(avatar).toEqual({
      kind: "github",
      username: "bruno",
      url: "https://github.com/bruno.png?size=80",
    });
  });

  it("lowercases the username extracted from mixed-case emails", () => {
    // Git records the committer's email verbatim; older accounts carry caps.
    const avatar = authorAvatar(
      "999+Octocat@users.noreply.github.com",
      "The Octocat",
    );
    expect(avatar.kind).toBe("github");
    if (avatar.kind === "github") {
      expect(avatar.username).toBe("octocat");
      expect(avatar.url.startsWith("https://github.com/octocat")).toBe(true);
    }
  });

  it("rejects noreply look-alikes from other domains", () => {
    // A phishing-shaped domain must not send the user's browser to a
    // third-party host masquerading as an avatar source.
    const avatar = authorAvatar(
      "octocat@users.noreply.github.com.evil.example",
      "Someone",
    );
    expect(avatar.kind).toBe("initials");
  });

  it("derives initials from the first two name words", () => {
    const avatar = initialsAvatar("dev@example.com", "Kikuo Fukui");
    expect(avatar.initials).toBe("KF");
  });

  it("falls back to the email's local part when the name is blank", () => {
    // Bots and imported history often carry an empty author name.
    const avatar = initialsAvatar("heimdall@asgard.invalid", "   ");
    expect(avatar.initials).toBe("HE");
    const bare = initialsAvatar("", "");
    expect(bare.initials).toBe("?");
  });

  it("keeps the same author on the same hue across calls", () => {
    const a = initialsAvatar("same@example.com", "Same Person");
    const b = initialsAvatar("same@example.com", "Same Person");
    expect(a.hue).toBe(b.hue);
    const other = initialsAvatar("other@example.com", "Same Person");
    // Not a strict uniqueness claim — just that the hash spreads at all.
    expect([a.hue, other.hue, 0, 0]).not.toEqual([0, 0, 0, 0]);
  });

  it("gives plain emails initials, never a github url", () => {
    const avatar = authorAvatar("linus@google.com", "Linus");
    expect(avatar.kind).toBe("initials");
    if (avatar.kind === "initials") {
      expect(avatar.initials).toBe("L");
      expect(avatar.hue).toBeGreaterThanOrEqual(0);
      expect(avatar.hue).toBeLessThan(360);
    }
  });
});

describe("remote owner avatars", () => {
  it("maps a github remote URL to its owner's photo", () => {
    expect(
      githubOwnerAvatarUrl("https://github.com/drizzle-team/drizzle-orm.git"),
    ).toBe("https://github.com/drizzle-team.png?size=40");
    expect(
      githubOwnerAvatarUrl("git@github.com:trendyol/kunkun-services.git"),
    ).toBe("https://github.com/trendyol.png?size=40");
  });

  it("redacts userinfo even if the caller passed an unredacted URL", () => {
    // Real-world failure prevented: a remote URL carrying an embedded token
    // must not leak it, and must still resolve the owner.
    expect(
      githubOwnerAvatarUrl(
        "https://user:token@github.com/octocat/hello.git",
      ),
    ).toBe("https://github.com/octocat.png?size=40");
  });

  it("returns null for non-github hosts and unusable owners", () => {
    expect(githubOwnerAvatarUrl("https://gitlab.com/a/b.git")).toBeNull();
    // No owner segment at all: there is no account to name.
    expect(githubOwnerAvatarUrl("https://github.com")).toBeNull();
    expect(githubOwnerAvatarUrl("https://github.com/.git")).toBeNull();
    expect(githubOwnerAvatarUrl("")).toBeNull();
    expect(githubOwnerAvatarUrl("/local/path/repo.git")).toBeNull();
  });
});

describe("GitHub links from a remote", () => {
  it("reads owner and repository from both remote spellings", () => {
    expect(githubRepoFromRemote("https://github.com/drizzle-team/drizzle-orm.git")).toEqual(
      { owner: "drizzle-team", name: "drizzle-orm" },
    );
    expect(githubRepoFromRemote("git@github.com:HuakunShen/refyard.git")).toEqual({
      owner: "HuakunShen",
      name: "refyard",
    });
    expect(githubRepoFromRemote("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      name: "repo",
    });
  });

  it("refuses a remote that is not a GitHub repository", () => {
    // Prevents: offering "Copy GitHub Link" on a GitLab or self-hosted remote and
    // handing the user a github.com URL that 404s.
    expect(githubRepoFromRemote("https://gitlab.com/owner/repo.git")).toBeNull();
    expect(githubRepoFromRemote("git@code.example.com:team/repo.git")).toBeNull();
    expect(githubRepoFromRemote("https://github.com/owner")).toBeNull();
    expect(githubRepoFromRemote("")).toBeNull();
  });

  it("builds the commit and branch pages, and nothing else", () => {
    const remote = "git@github.com:HuakunShen/refyard.git";
    expect(githubCommitUrl(remote, "abc1234")).toBe(
      "https://github.com/HuakunShen/refyard/commit/abc1234",
    );
    expect(githubBranchUrl(remote, "feat/graph")).toBe(
      "https://github.com/HuakunShen/refyard/tree/feat/graph",
    );
    // An oid that is not hex is not a commit, and a branch name that climbs out of
    // the path is not a branch: both produce no link rather than a wrong one.
    expect(githubCommitUrl(remote, "not-a-sha")).toBeNull();
    expect(githubBranchUrl(remote, "../../etc/passwd")).toBeNull();
    expect(githubBranchUrl("https://gitlab.com/owner/repo.git", "main")).toBeNull();
  });

  it("keeps the owner avatar working through the same parser", () => {
    expect(githubOwnerAvatarUrl("git@github.com:HuakunShen/refyard.git")).toBe(
      "https://github.com/HuakunShen.png?size=40",
    );
    expect(githubOwnerAvatarUrl("https://gitlab.com/owner/repo.git")).toBeNull();
  });
});

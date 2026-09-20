/**
 * Verifies the author-avatar mapping: GitHub photos from noreply emails,
 * deterministic initials for everyone else, and no spoofable look-alikes.
 */
import { describe, expect, it } from "vitest";
import {
  authorAvatar,
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

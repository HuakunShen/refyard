/**
 * Remote URL parsing: the single source the host and the UI share.
 *
 * The host derives forge coordinates from a repository's own remotes before it
 * calls a provider API, and the browser derives avatars and links from the
 * redacted display URL. Both must agree, so both call this one module; these
 * tests pin the accepted shapes and, more importantly, the refusals — a link
 * built from a hostile remote must not exist at all.
 */
import { describe, expect, it } from "vitest";
import { providerRepoFromRemote } from "@refyard/git-provider/remotes";

describe("providerRepoFromRemote", () => {
  it("parses the https spelling", () => {
    expect(providerRepoFromRemote("https://github.com/drizzle-team/drizzle-orm.git")).toEqual({
      provider: "github",
      owner: "drizzle-team",
      repo: "drizzle-orm",
    });
  });

  it("parses https without the .git suffix and with extra segments dropped", () => {
    expect(providerRepoFromRemote("https://github.com/octocat/Hello-World/")).toEqual({
      provider: "github",
      owner: "octocat",
      repo: "Hello-World",
    });
  });

  it("parses the scp-like spelling", () => {
    expect(providerRepoFromRemote("git@github.com:octocat/Hello-World.git")).toEqual({
      provider: "github",
      owner: "octocat",
      repo: "Hello-World",
    });
  });

  it("parses the ssh:// spelling with a userinfo and a port", () => {
    expect(providerRepoFromRemote("ssh://git@github.com:22/octocat/Hello-World.git")).toEqual({
      provider: "github",
      owner: "octocat",
      repo: "Hello-World",
    });
  });

  it("accepts www.github.com", () => {
    expect(providerRepoFromRemote("https://www.github.com/octocat/Hello-World.git")?.owner).toBe(
      "octocat",
    );
  });

  it("accepts single-character owners and dotted repositories", () => {
    expect(providerRepoFromRemote("https://github.com/o/repo.js.git")).toEqual({
      provider: "github",
      owner: "o",
      repo: "repo.js",
    });
  });

  it("refuses other forges rather than mislabelling them github", () => {
    // Every URL derived from this module is a github.com URL; a GitLab remote
    // must return null so callers omit the link instead of building a 404.
    expect(providerRepoFromRemote("https://gitlab.com/gildlab/sftper.git")).toBeNull();
    expect(providerRepoFromRemote("git@gitlab.com:gildlab/sftper.git")).toBeNull();
  });

  it("refuses hosts that only end in github.com", () => {
    expect(providerRepoFromRemote("https://github.com.evil.example/octocat/repo.git")).toBeNull();
    expect(providerRepoFromRemote("git@github.com.evil.example:octocat/repo.git")).toBeNull();
  });

  it("refuses owner or repository shapes that cannot be a repository", () => {
    expect(providerRepoFromRemote("https://github.com/settings")).toBeNull();
    expect(providerRepoFromRemote("https://github.com//repo.git")).toBeNull();
  });

  it("refuses non-URL input and bare hosts", () => {
    expect(providerRepoFromRemote("")).toBeNull();
    expect(providerRepoFromRemote("not a url")).toBeNull();
    expect(providerRepoFromRemote("https://github.com")).toBeNull();
    expect(providerRepoFromRemote("github.com/octocat/repo")).toBeNull();
  });

  it("refuses a url that smuggles userinfo into the owner position", () => {
    expect(providerRepoFromRemote("https://user:pass@github.com/octocat/repo.git")?.owner).toBe(
      "octocat",
    );
  });
});

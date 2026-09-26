import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createBackendRegistry } from "./backend-registry.js";

describe("the explicit Xross workbench entry", () => {
  it("keeps the standalone contract snapshot pinned to final Task 0.3", () => {
    const schema = readFileSync(
      new URL(
        "../../../../../integrations/xross/contracts/view-v1/schema.json",
        import.meta.url,
      ),
    );

    expect(createHash("sha256").update(schema).digest("hex")).toBe(
      "178cc0f93a27439a59f106db01e164a4d65d0b09051523f6e41dc005a6989059",
    );
  });

  it("fails closed when the native facade is absent instead of choosing another transport", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const loadNativePorts = vi.fn();

    const surface: "xross" = "xross";
    const registryOptions = {
      surface,
      runtime: { isTauri: true },
      loadNativePorts,
      loadXrossHost: async () => undefined,
      http: {
        baseUrl: "http://127.0.0.1:47831",
        fetch,
      },
    };
    const registry = createBackendRegistry(registryOptions);

    expect(registry.kind).toBe("xross");
    await expect(registry.connect()).rejects.toMatchObject({
      code: "HostUnavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(loadNativePorts).not.toHaveBeenCalled();
  });

  it("does not treat a present but malformed facade as permission to fall back", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const loadNativePorts = vi.fn();

    const surface: "xross" = "xross";
    const registryOptions = {
      surface,
      runtime: { isTauri: true },
      loadNativePorts,
      loadXrossHost: async () => ({}),
      http: {
        baseUrl: "http://127.0.0.1:47831",
        fetch,
      },
    };
    const registry = createBackendRegistry(registryOptions);

    await expect(registry.connect()).rejects.toMatchObject({
      code: "IncompatibleContract",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(loadNativePorts).not.toHaveBeenCalled();
  });

  it("requires no HTTP or Tauri options to select the Xross-only registry", async () => {
    const registry = createBackendRegistry({ surface: "xross", loadXrossHost: async () => undefined });
    expect(registry.kind).toBe("xross");
    await expect(registry.connect()).rejects.toMatchObject({ code: "HostUnavailable" });
  });
});

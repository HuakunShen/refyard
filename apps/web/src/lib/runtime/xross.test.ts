import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createBackendRegistry } from "./backend-registry.js";

describe("the explicit Xross workbench entry", () => {
  it("keeps the standalone contract snapshot pinned to reviewed Task 0.4", () => {
    const schema = readFileSync(
      new URL(
        "../../../../../integrations/xross/contracts/view-v1/schema.json",
        import.meta.url,
      ),
    );

    expect(createHash("sha256").update(schema).digest("hex")).toBe(
      "9f365418a12fec02c7ebbc770fa019e52c9d9e037817a4c3ef1c590888e1ba68",
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

/**
 * Tests for the browser-facing GitService client.
 *
 * The hosted password is a one-exchange input. Keeping this test at the client seam
 * prevents the UI from collecting a password while silently dropping it before HTTP.
 */
import { describe, expect, it } from "vitest";
import { createGitClient } from "@refyard/git-client/client";

describe("GitService session exchange", () => {
  it("sends a hosted password only in the session exchange body", async () => {
    // Prevents: the hosted form showing a password field that never reaches the
    // endpoint, which would leave the user unable to pair despite correct input.
    let request: RequestInit | undefined;
    const client = createGitClient({
      baseUrl: "https://api.example.test",
      fetch: async (_input, init) => {
        request = init;
        return new Response(
          JSON.stringify({
            token: "rfs_test_token",
            expiresAt: "2026-09-16T00:00:00.000Z",
            sessionId: "sess_test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await client.exchangeTicket("ticket-value-that-is-long-enough", "hosted-password");

    expect(request?.body).toBe(
      JSON.stringify({
        ticket: "ticket-value-that-is-long-enough",
        password: "hosted-password",
      }),
    );
  });
});

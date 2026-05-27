import { describe, expect, it } from "vitest";

import { SessionStore } from "../src/sessions/store.js";

describe("SessionStore", () => {
  it("renews active sessions and expires inactive ones", () => {
    let now = new Date("2026-05-26T00:00:00.000Z");
    const store = new SessionStore(1_000, () => now);
    const created = store.create();

    now = new Date("2026-05-26T00:00:00.500Z");
    expect(store.get(created.sessionId)?.expiresAt.toISOString()).toBe(
      "2026-05-26T00:00:01.500Z",
    );

    now = new Date("2026-05-26T00:00:01.501Z");
    expect(store.get(created.sessionId)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { readDraft } from "@/lib/draft";

const draft = {
  date: "2026-10-01", version: "a".repeat(64), latestDate: null,
  entries: [{ id: 1, type: "expense", description: "ค่ารถ", amount: ".", channel: "โอน" }],
};
describe("per-day drafts", () => {
  it("restores a day without letting another day's draft overwrite it", () => {
    const store = new Map([["draft:2026-10-01", JSON.stringify(draft)]]);
    const storage = { getItem: (key: string) => store.get(key) ?? null };
    expect(readDraft(storage, "draft", "2026-10-01")?.entries[0]?.description).toBe("ค่ารถ");
    expect(readDraft(storage, "draft", "2026-10-02")).toBeNull();
  });
  it("supports the old key but refuses malformed drafts", () => {
    expect(readDraft({ getItem: key => key === "draft" ? JSON.stringify(draft) : null }, "draft", draft.date)?.date).toBe(draft.date);
    expect(() => readDraft({ getItem: () => '{"entries":[]}' }, "draft", draft.date)).toThrow();
  });
});

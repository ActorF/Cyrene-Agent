import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SocialAtom } from "./social-context/types";

const { loadNative, warn } = vi.hoisted(() => ({ loadNative: vi.fn(), warn: vi.fn() }));
vi.mock("../shared/logger", () => ({ logger: { warn } }));
vi.mock("node:module", () => ({ createRequire: () => loadNative }));

function atom(content: string): SocialAtom {
  return {
    id: content, conversationId: "test", content, type: "long_term",
    evidenceTurnId: "turn", evidenceQuote: content, createdAt: 0, status: "active",
  };
}

beforeEach(() => {
  vi.resetModules();
  loadNative.mockReset();
  warn.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("optional native search tokenizer", () => {
  it("imports both retrieval paths without loading native bindings", async () => {
    loadNative.mockImplementation(() => { throw new Error("native unavailable"); });
    const rag = await import("./rag/text-ranking");
    await import("./social-context/retrieval");
    expect(rag.tokenizeText("Hello world").map((token) => token.word)).toEqual(["hello", "world"]);
    expect(loadNative).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["load", "constructor"])("retries once per call after %s failure, logs each failure, and keeps fallback ranking", async (failure) => {
    const nested = Object.assign(new Error("native DLL not found"), { code: "ERR_DLOPEN_FAILED" });
    const error = new Error("Failed to load native binding", { cause: [nested] });
    // Real loader errors may contain nested arrays or circular diagnostic data.
    Object.assign(nested, { cause: error });
    const construct = vi.fn(function () { throw error; });
    loadNative.mockImplementation(() => {
      if (failure === "load") throw error;
      return { Jieba: construct };
    });
    const { tokenizeText, rankTextCandidates } = await import("./rag/text-ranking");
    const { rankSocialAtoms } = await import("./social-context/retrieval");
    expect(tokenizeText("海边").map((token) => token.word)).toEqual(["海", "边"]);
    const ranked = rankTextCandidates("海边", [
      { item: "unrelated", text: "爬山" }, { item: "match", text: "喜欢海边" },
    ]);
    expect(ranked[0].item).toBe("match");
    expect(ranked[0].score).toBeGreaterThan(0);
    expect(rankSocialAtoms("海边", [atom("爬山"), atom("喜欢海边")], { now: 0 })
      .map((item) => item.content)).toEqual(["喜欢海边"]);
    // One standalone tokenization, then query + two candidates for each ranker.
    expect(loadNative).toHaveBeenCalledTimes(7);
    expect(loadNative.mock.calls.every(([name]) => name === "@node-rs/jieba")).toBe(true);
    expect(construct).toHaveBeenCalledTimes(failure === "constructor" ? 7 : 0);
    expect(warn).toHaveBeenCalledTimes(7);
    const [tag, label, detail] = warn.mock.calls[0];
    expect(tag).toBe("Search");
    expect(label).toContain("@node-rs/jieba");
    expect(label).toContain("fallback");
    expect(detail).toContain("Failed to load native binding");
    expect(detail).toContain("native DLL not found");
    expect(detail).toContain("ERR_DLOPEN_FAILED");
    expect(detail).toContain("search-jieba.test.ts");
    expect(detail).toContain("Circular");
  });

  it.each(["load", "constructor"])("recovers from %s failure on the next caller and then reuses the instance", async (failure) => {
    const error = new Error("temporarily unavailable");
    const native = {
      cut: vi.fn(() => ["海边"]),
      tag: vi.fn(() => [{ word: "海边", tag: "n" }]),
    };
    let constructionAttempts = 0;
    const construct = vi.fn(function () {
      if (failure === "constructor" && constructionAttempts++ === 0) throw error;
      return native;
    });
    loadNative.mockReturnValue({ Jieba: construct });
    if (failure === "load") loadNative.mockImplementationOnce(() => { throw error; });
    const { tokenizeText } = await import("./rag/text-ranking");
    const { rankSocialAtoms } = await import("./social-context/retrieval");

    expect(tokenizeText("海边").map((token) => token.word)).toEqual(["海", "边"]);
    expect(loadNative).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(rankSocialAtoms("海边", [atom("海边")], { now: 0 })).toHaveLength(1);
    expect(tokenizeText("海边")).toEqual([{ word: "海边", tag: "n", isStop: false, isNoun: true }]);
    expect(loadNative).toHaveBeenCalledTimes(2);
    expect(construct).toHaveBeenCalledTimes(failure === "constructor" ? 2 : 1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("shares a successful native instance and preserves native tags", async () => {
    const cut = vi.fn(() => ["海边"]);
    const tag = vi.fn(() => [{ word: "海边", tag: "n" }]);
    const construct = vi.fn(function () { return { cut, tag }; });
    loadNative.mockReturnValue({ Jieba: construct });
    const { tokenizeText } = await import("./rag/text-ranking");
    const { rankSocialAtoms } = await import("./social-context/retrieval");
    expect(tokenizeText("海边")).toEqual([{ word: "海边", tag: "n", isStop: false, isNoun: true }]);
    expect(rankSocialAtoms("海边", [atom("海边")], { now: 0 })).toHaveLength(1);
    expect(loadNative).toHaveBeenCalledOnce();
    expect(construct).toHaveBeenCalledOnce();
    expect(cut).toHaveBeenCalledWith("海边", true);
    expect(tag).toHaveBeenCalledWith("海边", true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the existing per-call fallback when native tokenization throws", async () => {
    const cut = vi.fn().mockImplementationOnce(() => { throw new Error("cut failed"); }).mockReturnValue(["海边"]);
    const tag = vi.fn(() => [{ word: "海边", tag: "n" }]);
    loadNative.mockReturnValue({ Jieba: class { cut = cut; tag = tag; } });
    const { tokenizeText } = await import("./rag/text-ranking");
    expect(tokenizeText("海边").map((token) => token.word)).toEqual(["海", "边"]);
    expect(tokenizeText("海边")[0].isNoun).toBe(true);
    expect(loadNative).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

import { copyLearningPrompt, copyPromptAndOpenProvider } from "./learningPromptCopy";

describe("learning prompt copy", () => {
  it("calls started once when clipboard copy succeeds", async () => {
    const recordStarted = vi.fn(async () => ({ ok: true, error: null, syncPending: false }));

    const result = await copyLearningPrompt({
      promptText: "Teach me",
      sessionId: "session-1",
      copyToClipboard: vi.fn(async () => undefined),
      recordSessionStartedAfterPromptCopy: recordStarted
    });

    expect(result).toEqual({ copied: true, syncPending: false });
    expect(recordStarted).toHaveBeenCalledOnce();
  });

  it("does not call started when clipboard copy fails", async () => {
    const recordStarted = vi.fn(async () => ({ ok: true, error: null, syncPending: false }));

    const result = await copyLearningPrompt({
      promptText: "Teach me",
      sessionId: "session-1",
      copyToClipboard: vi.fn(async () => {
        throw new Error("clipboard failed");
      }),
      recordSessionStartedAfterPromptCopy: recordStarted
    });

    expect(result).toEqual({ copied: false, syncPending: false });
    expect(recordStarted).not.toHaveBeenCalled();
  });

  it("does not open a provider when clipboard copy fails", async () => {
    const openUrl = vi.fn(async () => undefined);

    await copyPromptAndOpenProvider({
      providerId: "chatgpt",
      providerUrl: "https://chatgpt.com",
      copyPrompt: async () => ({ copied: false, syncPending: false }),
      canOpenUrl: vi.fn(async () => true),
      openUrl,
      onPromptReady: vi.fn(),
      onCopyFailed: vi.fn(),
      onOpenFailed: vi.fn(),
      onOpenSucceeded: vi.fn()
    });

    expect(openUrl).not.toHaveBeenCalled();
  });

  it("keeps the prompt marked used when provider opening fails after copy", async () => {
    const onPromptReady = vi.fn();

    const result = await copyPromptAndOpenProvider({
      providerId: "claude",
      providerUrl: "https://claude.ai/new",
      copyPrompt: async () => ({ copied: true, syncPending: false }),
      canOpenUrl: vi.fn(async () => true),
      openUrl: vi.fn(async () => {
        throw new Error("provider failed");
      }),
      onPromptReady,
      onCopyFailed: vi.fn(),
      onOpenFailed: vi.fn(),
      onOpenSucceeded: vi.fn()
    });

    expect(result).toEqual({ copied: true, syncPending: false, opened: false });
    expect(onPromptReady).toHaveBeenCalledOnce();
  });
});

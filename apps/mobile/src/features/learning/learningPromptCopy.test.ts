import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { copyLearningPrompt, copyPromptAndOpenProvider } from "./learningPromptCopy";
import { LEARNING_PROVIDER_LINKS } from "./providerLinks";

/**
 * Handing the reader to their assistant.
 *
 * The device bug: "Copy prompt" worked, but the ChatGPT/Claude/Gemini buttons
 * often did nothing. The three destinations are plain HTTPS links, and the
 * canOpenURL gate in front of them answered false often enough on iOS to
 * swallow the tap. The rule now is: copy first, then ask the OS to open, and
 * treat a failure as "the prompt is copied, paste it yourself" — never as a
 * dead button.
 */

describe("copyLearningPrompt", () => {
  it("records progress once when the copy succeeds", async () => {
    const recordStarted = vi.fn(async () => ({ ok: true, error: null, syncPending: false }));

    const result = await copyLearningPrompt({
      promptText: "Teach me",
      sessionId: "session-1",
      copyToClipboard: vi.fn(async () => undefined),
      recordSessionStartedAfterPromptCopy: recordStarted
    });

    expect(result).toEqual({ copied: true, progressRecorded: true, syncPending: false });
    expect(recordStarted).toHaveBeenCalledOnce();
  });

  it("reports progressRecorded false when the write was refused", async () => {
    // It used to hardcode true, so a refused write still told the reader their
    // session was saved and unlocked the feedback step.
    const result = await copyLearningPrompt({
      promptText: "Teach me",
      sessionId: "session-1",
      copyToClipboard: vi.fn(async () => undefined),
      recordSessionStartedAfterPromptCopy: vi.fn(async () => ({
        ok: false,
        error: { message: "Network request failed" },
        syncPending: false
      }))
    });

    expect(result).toEqual({ copied: true, progressRecorded: false, syncPending: false });
  });

  it("keeps a queued write as pending, not as failed", async () => {
    const result = await copyLearningPrompt({
      promptText: "Teach me",
      sessionId: "session-1",
      copyToClipboard: vi.fn(async () => undefined),
      recordSessionStartedAfterPromptCopy: vi.fn(async () => ({
        ok: true,
        error: null,
        syncPending: true
      }))
    });

    expect(result).toEqual({ copied: true, progressRecorded: true, syncPending: true });
  });

  it("does not record progress when the clipboard fails", async () => {
    const recordStarted = vi.fn(async () => ({ ok: true, error: null, syncPending: false }));

    const result = await copyLearningPrompt({
      promptText: "Teach me",
      sessionId: "session-1",
      copyToClipboard: vi.fn(async () => {
        throw new Error("clipboard failed");
      }),
      recordSessionStartedAfterPromptCopy: recordStarted
    });

    expect(result).toEqual({ copied: false, progressRecorded: false, syncPending: false });
    expect(recordStarted).not.toHaveBeenCalled();
  });

  it("returns progressRecorded false when the write throws", async () => {
    const result = await copyLearningPrompt({
      promptText: "Teach me",
      sessionId: "session-1",
      copyToClipboard: vi.fn(async () => undefined),
      recordSessionStartedAfterPromptCopy: vi.fn(async () => {
        throw new Error("AsyncStorage write failed");
      })
    });

    expect(result).toEqual({ copied: true, progressRecorded: false, syncPending: false });
  });

  it("does nothing without a prompt", async () => {
    const copyToClipboard = vi.fn(async () => undefined);

    const result = await copyLearningPrompt({
      promptText: null,
      sessionId: "session-1",
      copyToClipboard,
      recordSessionStartedAfterPromptCopy: vi.fn(async () => ({
        ok: true,
        error: null,
        syncPending: false
      }))
    });

    expect(result.copied).toBe(false);
    expect(copyToClipboard).not.toHaveBeenCalled();
  });
});

describe("copyPromptAndOpenProvider", () => {
  const handlers = () => ({
    onPromptReady: vi.fn(),
    onCopyFailed: vi.fn(),
    onOpenFailed: vi.fn(),
    onOpenSucceeded: vi.fn()
  });

  const copied = async () => ({
    copied: true,
    progressRecorded: true,
    syncPending: false
  });

  it("opens the provider straight away, with no canOpenURL gate", async () => {
    const openUrl = vi.fn(async () => undefined);
    const events = handlers();

    const result = await copyPromptAndOpenProvider({
      providerId: "chatgpt",
      providerUrl: LEARNING_PROVIDER_LINKS.chatgpt.url,
      copyPrompt: copied,
      openUrl,
      ...events
    });

    expect(openUrl).toHaveBeenCalledWith("https://chatgpt.com/");
    expect(result.opened).toBe(true);
    expect(events.onOpenSucceeded).toHaveBeenCalledWith("chatgpt", {
      copied: true,
      progressRecorded: true,
      syncPending: false
    });
    expect(events.onOpenFailed).not.toHaveBeenCalled();
  });

  it("keeps the prompt copied when the provider cannot be opened", async () => {
    const events = handlers();

    const result = await copyPromptAndOpenProvider({
      providerId: "claude",
      providerUrl: LEARNING_PROVIDER_LINKS.claude.url,
      copyPrompt: copied,
      openUrl: vi.fn(async () => {
        throw new Error("no handler");
      }),
      ...events
    });

    // The clipboard is written before any navigation, so a failed open still
    // leaves the reader able to paste.
    expect(result).toEqual({
      copied: true,
      progressRecorded: true,
      syncPending: false,
      opened: false
    });
    expect(events.onPromptReady).toHaveBeenCalledOnce();
    expect(events.onOpenFailed).toHaveBeenCalledOnce();
    expect(events.onOpenSucceeded).not.toHaveBeenCalled();
  });

  it("does not open anything when the copy failed", async () => {
    const openUrl = vi.fn(async () => undefined);
    const events = handlers();

    await copyPromptAndOpenProvider({
      providerId: "gemini",
      providerUrl: LEARNING_PROVIDER_LINKS.gemini.url,
      copyPrompt: async () => ({
        copied: false,
        progressRecorded: false,
        syncPending: false
      }),
      openUrl,
      ...events
    });

    expect(openUrl).not.toHaveBeenCalled();
    expect(events.onCopyFailed).toHaveBeenCalledOnce();
  });

  it("still opens when the copy worked but progress could not be recorded", async () => {
    const openUrl = vi.fn(async () => undefined);
    const events = handlers();

    const result = await copyPromptAndOpenProvider({
      providerId: "gemini",
      providerUrl: LEARNING_PROVIDER_LINKS.gemini.url,
      copyPrompt: async () => ({
        copied: true,
        progressRecorded: false,
        syncPending: false
      }),
      openUrl,
      ...events
    });

    expect(openUrl).toHaveBeenCalledOnce();
    expect(result.opened).toBe(true);
  });

  it.each(["chatgpt", "claude", "gemini"] as const)(
    "opens %s over https",
    async (providerId) => {
      const openUrl = vi.fn(async () => undefined);

      await copyPromptAndOpenProvider({
        providerId,
        providerUrl: LEARNING_PROVIDER_LINKS[providerId].url,
        copyPrompt: copied,
        openUrl,
        ...handlers()
      });

      const [url] = openUrl.mock.calls[0] as unknown as [string];

      expect(url.startsWith("https://")).toBe(true);
      // No undocumented custom scheme, no fragile prefill query string.
      expect(url).not.toMatch(/\?/);
    }
  );
});

describe("provider destinations", () => {
  it("are the three documented HTTPS entry points", () => {
    expect(LEARNING_PROVIDER_LINKS.chatgpt.url).toBe("https://chatgpt.com/");
    expect(LEARNING_PROVIDER_LINKS.claude.url).toBe("https://claude.ai/");
    expect(LEARNING_PROVIDER_LINKS.gemini.url).toBe("https://gemini.google.com/app");
  });

  it("are opened without a capability pre-check anywhere in the flow", () => {
    const flow = readFileSync(join(__dirname, "learningPromptCopy.ts"), "utf8");
    const screen = readFileSync(join(__dirname, "LearningSessionScreen.tsx"), "utf8");

    // The prose explains why the gate was removed; what must be gone is the
    // call itself.
    expect(flow).not.toMatch(/input\.canOpenUrl/);
    expect(flow).not.toMatch(/canOpenUrl\s*:/);
    expect(screen).not.toMatch(/Linking\.canOpenURL/);
  });

  it("records the analytics event only after a successful open", () => {
    const screen = readFileSync(join(__dirname, "LearningSessionScreen.tsx"), "utf8");
    const onOpenSucceeded = screen.slice(screen.indexOf("onOpenSucceeded"));
    const onOpenFailed = screen.slice(
      screen.indexOf("onOpenFailed"),
      screen.indexOf("onOpenSucceeded")
    );

    expect(onOpenSucceeded).toMatch(/learning_provider_opened/);
    expect(onOpenFailed).not.toMatch(/learning_provider_opened/);
  });
});

import type { LearningProviderId } from "./learningTypes";

export type LearningPromptCopyResult = {
  copied: boolean;
  progressRecorded: boolean;
  syncPending: boolean;
};

export async function copyLearningPrompt(input: {
  promptText: string | null | undefined;
  sessionId: string;
  copyToClipboard: (value: string) => Promise<unknown>;
  recordSessionStartedAfterPromptCopy: (
    sessionId: string
  ) => Promise<{ ok: boolean; error: unknown; syncPending: boolean }>;
}): Promise<LearningPromptCopyResult> {
  if (!input.promptText) {
    return { copied: false, progressRecorded: false, syncPending: false };
  }

  try {
    await input.copyToClipboard(input.promptText);
  } catch {
    return { copied: false, progressRecorded: false, syncPending: false };
  }

  try {
    const result = await input.recordSessionStartedAfterPromptCopy(input.sessionId);

    // progressRecorded follows the actual outcome. It used to be hardcoded to
    // true, so a refused write still told the reader their progress was saved
    // and unlocked "I've finished" on a session the server knows nothing about.
    return {
      copied: true,
      progressRecorded: result.ok,
      syncPending: result.syncPending
    };
  } catch {
    return { copied: true, progressRecorded: false, syncPending: false };
  }
}

/**
 * Whether a destination may be handed to the OS.
 *
 * The three provider URLs are constants in this repo, so today this can only
 * ever be true — which is the point: it is a standing guarantee that no custom
 * scheme, and nothing that is not a plain HTTPS address, is ever launched from
 * here, whatever a future edit to the provider table does.
 */
export function isOpenableProviderUrl(url: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(url.trim());
}

/**
 * Copy the prompt, record the session as started, then hand the reader to their
 * assistant.
 *
 * There is deliberately no canOpenURL gate. The three destinations are ordinary
 * HTTPS URLs owned by the providers, so the OS always has a handler: the
 * installed app through its universal link, or the browser. canOpenURL answers
 * about *schemes*, and on iOS it returned false for these https links often
 * enough that the buttons simply did nothing — while "Copy prompt" right next
 * to them worked. Asking the OS to open the URL and handling the failure is
 * both simpler and more accurate than asking permission first.
 *
 * The prompt is copied before any navigation, so it stays on the clipboard
 * whatever the opening does. That is the property that makes a failure
 * recoverable: the reader pastes it themselves.
 */
export async function copyPromptAndOpenProvider(input: {
  providerId: LearningProviderId;
  providerUrl: string;
  copyPrompt: () => Promise<LearningPromptCopyResult>;
  openUrl: (url: string) => Promise<unknown>;
  onPromptReady: (result: LearningPromptCopyResult) => void;
  onCopyFailed: () => void;
  onOpenFailed: (result: LearningPromptCopyResult) => void;
  onOpenSucceeded: (providerId: LearningProviderId, result: LearningPromptCopyResult) => void;
}): Promise<LearningPromptCopyResult & { opened: boolean }> {
  const copyResult = await input.copyPrompt();

  if (!copyResult.copied) {
    input.onCopyFailed();
    return { ...copyResult, opened: false };
  }

  input.onPromptReady(copyResult);

  if (!isOpenableProviderUrl(input.providerUrl)) {
    // Same outcome as a refused open, and for the same reason: the prompt is
    // already on the clipboard, so the reader is told to paste it themselves
    // rather than shown that anything went wrong.
    input.onOpenFailed(copyResult);
    return { ...copyResult, opened: false };
  }

  try {
    await input.openUrl(input.providerUrl);
    input.onOpenSucceeded(input.providerId, copyResult);
    return { ...copyResult, opened: true };
  } catch {
    // The prompt is on the clipboard either way; the caller tells the reader to
    // open the assistant and paste it.
    input.onOpenFailed(copyResult);
    return { ...copyResult, opened: false };
  }
}

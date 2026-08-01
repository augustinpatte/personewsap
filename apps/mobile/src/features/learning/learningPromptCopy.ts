import type { LearningProviderId } from "./learningTypes";

export type LearningPromptCopyResult = {
  copied: boolean;
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
    return { copied: false, syncPending: false };
  }

  try {
    await input.copyToClipboard(input.promptText);
  } catch {
    return { copied: false, syncPending: false };
  }

  const result = await input.recordSessionStartedAfterPromptCopy(input.sessionId);
  return { copied: true, syncPending: result.syncPending };
}

export async function copyPromptAndOpenProvider(input: {
  providerId: LearningProviderId;
  providerUrl: string;
  copyPrompt: () => Promise<LearningPromptCopyResult>;
  canOpenUrl: (url: string) => Promise<boolean>;
  openUrl: (url: string) => Promise<void>;
  onPromptReady: (result: LearningPromptCopyResult) => void;
  onCopyFailed: () => void;
  onOpenFailed: () => void;
  onOpenSucceeded: (providerId: LearningProviderId, result: LearningPromptCopyResult) => void;
}): Promise<LearningPromptCopyResult & { opened: boolean }> {
  const copyResult = await input.copyPrompt();

  if (!copyResult.copied) {
    input.onCopyFailed();
    return { ...copyResult, opened: false };
  }

  input.onPromptReady(copyResult);

  try {
    const supported = await input.canOpenUrl(input.providerUrl);
    if (!supported) {
      input.onOpenFailed();
      return { ...copyResult, opened: false };
    }

    await input.openUrl(input.providerUrl);
    input.onOpenSucceeded(input.providerId, copyResult);
    return { ...copyResult, opened: true };
  } catch {
    input.onOpenFailed();
    return { ...copyResult, opened: false };
  }
}

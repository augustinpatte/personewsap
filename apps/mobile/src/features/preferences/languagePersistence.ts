export function shouldApplyLanguageSaveResult(input: {
  requestId: number;
  latestRequestId: number;
}): boolean {
  return input.requestId === input.latestRequestId;
}

export function shouldRollbackLanguageSelection(input: {
  persisted: boolean | void;
  requestId: number;
  latestRequestId: number;
}): boolean {
  return input.persisted === false && shouldApplyLanguageSaveResult(input);
}

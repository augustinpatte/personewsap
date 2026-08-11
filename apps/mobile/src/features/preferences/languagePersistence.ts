export type LanguageSaveLockState = {
  inFlight: boolean;
  latestRequestId: number;
};

export function createLanguageSaveLockState(): LanguageSaveLockState {
  return { inFlight: false, latestRequestId: 0 };
}

export function beginLanguageSave(
  state: LanguageSaveLockState
): { started: true; requestId: number; state: LanguageSaveLockState } | { started: false; state: LanguageSaveLockState } {
  if (state.inFlight) {
    return { started: false, state };
  }

  const requestId = state.latestRequestId + 1;
  return {
    started: true,
    requestId,
    state: {
      inFlight: true,
      latestRequestId: requestId
    }
  };
}

export function finishLanguageSave(
  state: LanguageSaveLockState,
  requestId: number
): LanguageSaveLockState {
  if (state.latestRequestId !== requestId) {
    return state;
  }

  return {
    ...state,
    inFlight: false
  };
}

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

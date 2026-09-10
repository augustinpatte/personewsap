/**
 * The launch-time notification registration, as something other code can wait
 * for.
 *
 * `usePushTokenRefresh` shows Apple's prompt on a first launch and registers
 * the device. The disabled-notifications banner must not judge the state while
 * that is still in flight — a reader who is being registered right now would be
 * told notifications are off. So the registration is tracked here, and the
 * banner waits for it (never for long) before reading anything.
 */

let pending: Promise<void> | null = null;

export function trackStartupRegistration(registration: Promise<unknown>): void {
  pending = registration.then(
    () => undefined,
    () => undefined
  );
}

export async function waitForStartupRegistration(timeoutMs = 4_000): Promise<void> {
  if (!pending) {
    return;
  }

  await Promise.race([
    pending,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

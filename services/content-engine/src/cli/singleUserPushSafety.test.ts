import { afterEach, describe, expect, it } from "vitest";

import {
  parsePushNotificationsOptions,
  SingleUserPushConfirmationError
} from "./pushNotifications.js";

/**
 * `--user` is the only way to reach one real device from a laptop, so it is the
 * only flag in this command that can surprise a person holding a phone. It is
 * therefore refused unless the operator says so twice: once by naming the
 * account, once with CONFIRM_SINGLE_USER_PUSH=true. Without the flag the
 * command keeps its normal behaviour — announce the edition to everyone
 * eligible — and there is no flag that broadcasts to "all users" on demand.
 */

const READER = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  delete process.env.CONFIRM_SINGLE_USER_PUSH;
});

describe("single-user push safety", () => {
  it("refuses a single-user send without the explicit confirmation", () => {
    expect(() => parsePushNotificationsOptions(["--user", READER])).toThrow(
      SingleUserPushConfirmationError
    );
  });

  it("refuses when the confirmation is anything but true", () => {
    process.env.CONFIRM_SINGLE_USER_PUSH = "yes";

    expect(() => parsePushNotificationsOptions(["--user", READER])).toThrow(
      SingleUserPushConfirmationError
    );
  });

  it("accepts a confirmed single-user send", () => {
    process.env.CONFIRM_SINGLE_USER_PUSH = "true";

    const options = parsePushNotificationsOptions(["--user", READER, "--date", "2026-09-04"]);

    expect(options.onlyUserId).toBe(READER);
    expect(options.dropDate).toBe("2026-09-04");
  });

  it("rejects anything that is not an account id, confirmed or not", () => {
    process.env.CONFIRM_SINGLE_USER_PUSH = "true";

    expect(() => parsePushNotificationsOptions(["--user", "all"])).toThrow(
      /expects one reader's account id/
    );
    expect(() => parsePushNotificationsOptions(["--user", "*"])).toThrow(
      /expects one reader's account id/
    );
  });

  it("leaves the normal scheduled run untargeted and unconfirmed", () => {
    const options = parsePushNotificationsOptions(["--date", "2026-09-04"]);

    expect(options.onlyUserId).toBeNull();
    expect(process.env.CONFIRM_SINGLE_USER_PUSH).toBeUndefined();
  });
});

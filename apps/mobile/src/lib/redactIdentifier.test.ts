import { describe, expect, it } from "vitest";

import { redactIdentifier } from "./redactIdentifier";

describe("redactIdentifier", () => {
  it("keeps only the ends of a long id", () => {
    expect(redactIdentifier("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaabcd")).toBe("aaaa...abcd");
  });

  it("leaves a short value as it is", () => {
    expect(redactIdentifier("abcd1234")).toBe("abcd1234");
  });
});

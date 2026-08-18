import { describe, expect, it } from "vitest";

import {
  getProductEditionDate as getMobileEditionDate,
  PRODUCT_TIME_ZONE as MOBILE_TIME_ZONE
} from "../../apps/mobile/src/features/today/editionCadence";
import {
  getProductEditionDate as getEngineEditionDate,
  PRODUCT_TIME_ZONE as ENGINE_TIME_ZONE
} from "../../services/content-engine/src/scheduler/editionCadence";

/**
 * The app and the content engine must resolve the same YYYY-MM-DD for the same
 * instant, or the app requests an edition the job has not built.
 *
 * This test deliberately lives at the repo root: it is the only place that can
 * import both mirrors (apps/mobile and services/content-engine) and compare
 * them directly. Both modules are dependency-free, so importing them here costs
 * nothing and pins the contract on both sides at once.
 */

const instants = [
  // The nightly window where UTC and Paris disagree.
  "2026-06-21T22:30:00Z", // 00:30 Paris, summer (CEST, UTC+2)
  "2026-06-21T23:59:59Z",
  "2026-01-14T23:30:00Z", // 00:30 Paris, winter (CET, UTC+1)
  "2026-01-14T23:00:00Z", // exactly midnight Paris, winter
  "2026-06-21T22:00:00Z", // exactly midnight Paris, summer
  // Both DST transitions.
  "2026-03-28T23:30:00Z",
  "2026-03-29T00:30:00Z",
  "2026-10-24T22:30:00Z",
  "2026-10-25T00:30:00Z",
  // Ordinary moments, where the two never disagreed.
  "2026-08-17T09:00:00Z",
  "2026-08-17T12:00:00Z",
  "2026-12-31T23:59:00Z",
  "2027-01-01T00:00:00Z"
];

describe("editorial date parity between the app and the content engine", () => {
  it("declares the same single product timezone on both sides", () => {
    expect(MOBILE_TIME_ZONE).toBe("Europe/Paris");
    expect(ENGINE_TIME_ZONE).toBe(MOBILE_TIME_ZONE);
  });

  it.each(instants)("resolves the same edition date at %s", (iso) => {
    const instant = new Date(iso);

    expect(getEngineEditionDate(instant)).toBe(getMobileEditionDate(instant));
  });

  it("is the Paris date, not the UTC one, in the nightly window", () => {
    const instant = new Date("2026-06-21T22:30:00Z");

    expect(getMobileEditionDate(instant)).toBe("2026-06-22");
    expect(getEngineEditionDate(instant)).toBe("2026-06-22");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-06-21");
  });

  it("agrees across a whole year of hourly instants", () => {
    // A day's worth of hours on the 1st of each month: cheap, and it covers
    // every offset the year has.
    for (let month = 0; month < 12; month += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const instant = new Date(Date.UTC(2026, month, 1, hour, 30));

        expect(getEngineEditionDate(instant)).toBe(getMobileEditionDate(instant));
      }
    }
  });
});

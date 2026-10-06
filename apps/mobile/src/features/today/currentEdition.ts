import { isDateKey } from "../../lib/localDate";
import { normalizeSupabaseError, supabase, type NormalizedSupabaseError } from "../../lib/supabase";
import { getProductEditionDate, isEditionDay, resolveReaderEditionDate } from "./editionCadence";

/**
 * Which edition Today shows, decided by the backend's own edition model.
 *
 * `public.editions` holds one row per published edition, and
 * `public.current_edition_date()` returns the one that is OPEN now: the most
 * recently published. An edition stays open until the next one publishes
 * (`edition_closes_at`). Scoring, Team play and the morning answer reminder all
 * run on that definition, so Today does too. A Monday edition is therefore
 * still Today on Tuesday morning, which is exactly when the reminder asks the
 * reader to finish it. The reader's local midnight no longer hides it.
 *
 * The reader-local calendar (`resolveReaderEditionDate`) is kept only as the
 * fallback for when the backend cannot answer (no edition has ever published,
 * or the read failed), so Today keeps working exactly as before in that case.
 */

export type CurrentEditionResult = {
  editionDate: string | null;
  error: NormalizedSupabaseError | null;
};

export async function fetchCurrentEditionDate(): Promise<CurrentEditionResult> {
  if (!supabase) {
    return { editionDate: null, error: null };
  }

  try {
    const { data, error } = await supabase.rpc("current_edition_date");

    if (error) {
      return { editionDate: null, error: normalizeSupabaseError(error) };
    }

    return {
      editionDate: typeof data === "string" && isDateKey(data.slice(0, 10)) ? data.slice(0, 10) : null,
      error: null
    };
  } catch (error) {
    return { editionDate: null, error: normalizeSupabaseError(error) };
  }
}

/** The open edition when the backend names one; the reader-day rule otherwise. */
export function resolveTodayTargetDate(input: {
  currentEditionDate: string | null;
  now?: Date;
  timeZone?: string;
}): string {
  return input.currentEditionDate ?? resolveReaderEditionDate(input.now, input.timeZone);
}

/**
 * True while a newer edition is due but has not published yet: today is a
 * publication day on the publisher's calendar and the open edition is older.
 * That is the window in which returning to the app should look again.
 */
export function isNextEditionPending(input: {
  currentEditionDate: string | null;
  now?: Date;
}): boolean {
  const productDay = getProductEditionDate(input.now);

  if (!isEditionDay(productDay)) {
    return false;
  }

  return input.currentEditionDate === null || input.currentEditionDate < productDay;
}

/** A notification payload's date, accepted only if it is a real `YYYY-MM-DD`. */
export function parseEditionDateParam(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== "string" || !isDateKey(raw)) {
    return null;
  }

  const parsed = new Date(`${raw}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? null : raw;
}

/**
 * Whether returning to the foreground should re-read Today.
 *
 * Reload when it can change what the reader sees, and only then:
 *   - the calendar moved (publisher day or reader day changed), or
 *   - an edition is due and not here yet (the "upcoming" window), or
 *   - what is on screen is older than the content cache's own TTL.
 *
 * Never while a load is already running, and never more often than
 * `minIntervalMs` for the "upcoming" rule, so flicking in and out of the app
 * cannot turn into a request storm.
 */
export function decideForegroundReload(input: {
  now: number;
  lastLoadedAt: number | null;
  loading: boolean;
  ttlMs: number;
  minIntervalMs: number;
  editionKeyChanged: boolean;
  awaitingPublication: boolean;
  pinned: boolean;
}): boolean {
  if (input.loading) {
    return false;
  }

  if (input.editionKeyChanged || input.lastLoadedAt === null) {
    return true;
  }

  const age = input.now - input.lastLoadedAt;

  // An edition the reader deliberately opened (a notification, an old link)
  // is not replaced behind their back just because time passed.
  if (input.pinned) {
    return false;
  }

  if (input.awaitingPublication) {
    return age >= input.minIntervalMs;
  }

  return age >= input.ttlMs;
}

/** The calendar facts whose change must always trigger a reload. */
export function resolveEditionKey(now: Date = new Date()): string {
  return `${getProductEditionDate(now)}|${resolveReaderEditionDate(now)}`;
}

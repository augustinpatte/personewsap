/**
 * Only the newest load may draw.
 *
 * A Team standing is loaded from several triggers that can overlap: opening the
 * screen, switching range, a broadcast, a return to the foreground, the quiz
 * scoring. Two requests in flight can answer in either order, and an older
 * answer landing last used to overwrite a newer one — the leaderboard showed a
 * score from before the latest answer, or This Week's rows under All Time.
 *
 * Every load takes a ticket; only the answer holding the latest ticket is
 * applied. Nothing is cancelled, nothing is merged, and the server stays the
 * only source of what is drawn.
 */
export function createLatestRequestGate() {
  let latest = 0;

  return {
    issue(): number {
      latest += 1;
      return latest;
    },
    isLatest(ticket: number): boolean {
      return ticket === latest;
    }
  };
}

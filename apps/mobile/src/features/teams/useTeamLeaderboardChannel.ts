import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { supabase } from "../../lib/supabase";
import {
  LEADERBOARD_REFRESH_DEBOUNCE_MS,
  readLeaderboardChange,
  resolveChannelIntent,
  teamLeaderboardTopic
} from "./realtimePolicy";

/**
 * The one Realtime channel this product ever opens.
 *
 * Subscribed when a Team Detail screen is on screen and the reader is a member;
 * closed the moment either stops being true, including when the app goes to the
 * background. The decision itself is `resolveChannelIntent`, which is pure and
 * tested; this hook is the socket and the cleanup.
 *
 * WHY THE CLEANUP MATTERS MORE THAN USUAL. Free gives 200 concurrent Realtime
 * connections for the entire product. A channel leaked on unmount is not a
 * slow memory drip — it is a permanent seat taken from the budget until the app
 * is killed, and a reader who visits four Teams in a session would hold four.
 * So `removeChannel` runs in the effect's teardown, unconditionally, and the
 * ref is cleared in the same step.
 *
 * The payload is a nudge and nothing more: the screen refetches the leaderboard
 * it is already entitled to read. Broadcasting the standing itself would put
 * scores on the message bus, cost more per message, and create a second source
 * of truth that could disagree with the database.
 *
 * A BROADCAST SENT WHILE THE CHANNEL IS DOWN IS GONE. So every time the channel
 * reaches SUBSCRIBED — its first join, and every rejoin after the network or the
 * socket came back — the screen is nudged once too. That closes the gap between
 * the screen's first fetch and the join, and every reconnection gap after it,
 * without a single polling timer.
 */
export function useTeamLeaderboardChannel(input: {
  teamId: string | null;
  isMember: boolean;
  onChanged: () => void;
}) {
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const topicRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangedRef = useRef(input.onChanged);

  onChangedRef.current = input.onChanged;

  useEffect(() => {
    // Captured once so every closure below sees the same non-null client;
    // `supabase` is nullable when the build has no Supabase config at all.
    const client = supabase;

    if (!client) {
      return;
    }

    let isActive = AppState.currentState === "active";

    // Five team-mates answering within a second produce five broadcasts;
    // refetching five times would turn a saving into a cost.
    const nudge = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        onChangedRef.current();
      }, LEADERBOARD_REFRESH_DEBOUNCE_MS);
    };

    const apply = () => {
      const intent = resolveChannelIntent({
        visibleTeamId: input.teamId,
        currentTopic: topicRef.current,
        isActive,
        isMember: input.isMember
      });

      if (intent.action === "none") {
        return;
      }

      // Close first, always — including on a resubscribe, so two channels are
      // never open at once even for a frame.
      if (channelRef.current) {
        void client.removeChannel(channelRef.current);
        channelRef.current = null;
        topicRef.current = null;
      }

      if (intent.action === "unsubscribe") {
        return;
      }

      const topic = intent.topic;
      const channel = client.channel(topic, { config: { private: true } });

      channel
        .on("broadcast", { event: "leaderboard_changed" }, (message) => {
          // Refuses a payload carrying a score, a grade or an answer. A client
          // that rendered one would be rendering the answer key.
          if (!readLeaderboardChange(message.payload)) {
            return;
          }

          nudge();
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            nudge();
          }
        });

      channelRef.current = channel;
      topicRef.current = topic;
    };

    apply();

    const appStateSubscription = AppState.addEventListener("change", (next) => {
      isActive = next === "active";
      apply();
    });

    return () => {
      appStateSubscription.remove();

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      // Unconditional. A leaked channel holds a seat in a 200-connection budget
      // until the app is killed.
      if (channelRef.current) {
        void client.removeChannel(channelRef.current);
      }

      channelRef.current = null;
      topicRef.current = null;
    };
  }, [input.isMember, input.teamId]);
}

export { teamLeaderboardTopic };

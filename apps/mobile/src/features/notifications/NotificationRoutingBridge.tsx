import { useDailyDrop } from "../today/DailyDropContext";
import { useNotificationRouting } from "./useNotificationRouting";

/**
 * Follows tapped notifications from inside Today's provider, so the edition a
 * notification names is loaded fresh as the reader is taken to it: that exact
 * edition when the payload carries its drop_date, the open edition otherwise.
 * A tap on "your edition is here" therefore never lands on a cached "on its
 * way", from a cold start or a warm one.
 */
export function NotificationRoutingBridge() {
  const { openEdition, reload } = useDailyDrop();

  useNotificationRouting({
    onFollow: (route) => {
      if (route.dropDate) {
        void openEdition(route.dropDate);
        return;
      }

      reload();
    }
  });

  return null;
}

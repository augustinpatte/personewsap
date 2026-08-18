import {
  createExpoPushReceiptClient,
  reconcileExpoPushReceipts,
  type ReconcilePushReceiptsResult
} from "../notifications/pushSender.js";
import { createSupabasePushNotificationStore } from "../notifications/supabasePushStore.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";

export type PushReceiptsOptions = {
  dryRun: boolean;
  limit: number;
};

export type PushReceiptsOutput = {
  mode: "push-receipts";
  dryRun: boolean;
  result: ReconcilePushReceiptsResult | null;
  note: string;
};

export function parsePushReceiptsOptions(args: string[]): PushReceiptsOptions {
  const flags = readFlags(args);
  const limit = Number.parseInt(flags.get("limit") ?? process.env.PUSH_RECEIPT_LIMIT ?? "100", 10);

  return {
    dryRun: flags.has("dry-run") || process.env.DRY_RUN === "true",
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 100
  };
}

export async function runPushReceipts(options: PushReceiptsOptions): Promise<PushReceiptsOutput> {
  if (options.dryRun) {
    return {
      mode: "push-receipts",
      dryRun: true,
      result: null,
      note: "Dry run: no Expo receipts were fetched and no delivery rows were updated."
    };
  }

  const supabase = createServiceRoleSupabaseClient({ requireCredentials: true });
  const store = createSupabasePushNotificationStore(supabase);
  const client = createExpoPushReceiptClient();
  const result = await reconcileExpoPushReceipts({
    store,
    client,
    limit: options.limit
  });

  return {
    mode: "push-receipts",
    dryRun: false,
    result,
    note:
      result.retryable > 0
        ? "Some receipts were not final. Re-run this command later; terminal and sent rows are not retried."
        : "Receipt reconciliation complete."
  };
}

function readFlags(args: string[]): Map<string, string> {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];

    if (next && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
      continue;
    }

    values.set(key, "true");
  }

  return values;
}

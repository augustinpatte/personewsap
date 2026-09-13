import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "../../lib/supabase";
import { teamsIntroStorageKey, type TeamsIntroServerState } from "./teamsIntroRules";

/**
 * Where "this reader finished the Teams introduction" is kept.
 *
 * The server is the record: profiles.teams_intro_completed_at, readable only by
 * its owner, and written only through complete_teams_intro(), which keeps the
 * first completion and can never clear it. The device keeps a copy per user id,
 * so a completion made offline is not shown again before the server hears of
 * it. Nothing here throws: a failure reads as "unknown" or "not on this device".
 */

export async function fetchTeamsIntroServerState(userId: string): Promise<TeamsIntroServerState> {
  if (!supabase) {
    return "unknown";
  }

  try {
    // Its own query, never folded into the Teams profile read: against a
    // database that predates the column this fails alone, and Teams still opens.
    const { data, error } = await supabase
      .from("profiles")
      .select("teams_intro_completed_at")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      return "unknown";
    }

    const completedAt = (data as { teams_intro_completed_at?: string | null }).teams_intro_completed_at;
    return typeof completedAt === "string" && completedAt.length > 0 ? "completed" : "pending";
  } catch {
    return "unknown";
  }
}

export async function markTeamsIntroCompleted(): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  try {
    const { error } = await supabase.rpc("complete_teams_intro");
    return !error;
  } catch {
    return false;
  }
}

export async function readTeamsIntroCompletedOnDevice(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(teamsIntroStorageKey(userId))) !== null;
  } catch {
    return false;
  }
}

export async function rememberTeamsIntroCompletedOnDevice(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(teamsIntroStorageKey(userId), new Date().toISOString());
  } catch {
    // The server copy is the one that matters; this only saves a repeat.
  }
}

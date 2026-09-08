import { useMemo, useState } from "react";
import { Image, Linking, StyleSheet, TextInput, View } from "react-native";

import { AppText, Card, PressableSurface, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { COUNTRIES, countryName, searchCountries, type Country } from "./countries";
import { PlayerAvatar } from "./PlayerAvatar";
import { normalizeCountryCode, validateUsername } from "./playerProfile";
import type { PlayerProfile } from "./playerProfile";
import { deleteAvatarObject, pickAndCompressAvatar, uploadAvatar } from "./avatarUpload";
import { getTeamsCopy } from "./teamsCopy";
import { isUsernameAvailable, savePlayerIdentity } from "./teamsData";

/**
 * The player identity form, used both as the Teams gate and as Account's editor.
 *
 * ONE COMPONENT, TWO ENTRANCES. The gate and "Edit player profile" ask for
 * exactly the same things and enforce exactly the same rules; shipping them as
 * two screens would mean two places for the username regex, the country list
 * and the avatar budget to drift apart, and the one that drifted would be the
 * one a reader edits months later.
 *
 * TWO ARE REQUIRED, THE PHOTO IS NOT. Name and country gate Teams; the photo is
 * offered beside them and never blocks Save. It briefly did, and that put a
 * photo-library permission dialog between somebody and the first Team a friend
 * invited them to. It can be added now, added later, replaced, or taken off
 * again — the last of which is a real action here rather than a re-upload of
 * nothing, because the server's write COALESCEs its arguments and NULL means
 * "leave it alone".
 *
 * PERMISSION IS ASKED ON THE TAP AND NEVER ON MOUNT. Opening this screen shows
 * no system dialog. The reader reads "Choose a photo", decides, and only then
 * does the OS ask — which is what makes a refusal informed. A refusal that
 * cannot be reversed in-app is answered with Open Settings rather than a Retry
 * button that can no longer do anything.
 *
 * VALIDATION IS TWO-LAYERED AND THE LAYERS HAVE DIFFERENT JOBS. The local check
 * gives a fast, well-worded refusal for shape problems. The server decides
 * uniqueness, in the same statement that writes — so two readers racing for
 * "augustin" cannot both win, and the loser is told rather than silently
 * overwriting.
 */

/** Enough results to choose from without turning the page into a directory. */
const COUNTRY_RESULT_LIMIT = 8;

type Stage = "idle" | "preparing" | "uploading" | "saving";

export function PlayerProfileForm({
  onCompleted,
  profile,
  submitLabel
}: {
  onCompleted: (profile: PlayerProfile) => void;
  profile: PlayerProfile;
  submitLabel?: string;
}) {
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const { profileLanguage, user } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);

  const [username, setUsername] = useState(profile.username ?? "");
  const [countryCode, setCountryCode] = useState(profile.countryCode ?? "");
  const [countryQuery, setCountryQuery] = useState("");
  const [pickingCountry, setPickingCountry] = useState(!profile.countryCode);
  // The stored path, and separately the photo chosen in this session but not
  // yet uploaded. Uploading on save rather than on pick means abandoning the
  // screen leaves no orphan object in a bucket nothing will ever point at.
  const [avatarPath, setAvatarPath] = useState(profile.avatarPath ?? null);
  const [pendingAvatar, setPendingAvatar] = useState<{
    uri: string;
    base64: string;
    bytes: number;
  } | null>(null);
  // Set by "Remove", cleared by choosing a new photo. It is what turns the save
  // into an explicit erase rather than a no-op.
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [permissionBlocked, setPermissionBlocked] = useState<"retry" | "settings" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");

  const busy = stage !== "idle";

  const countryResults = useMemo(
    () => searchCountries(countryQuery, language),
    [countryQuery, language]
  );

  const selectedCountry: Country | null =
    COUNTRIES.find((entry) => entry.code === countryCode) ?? null;

  const hasPhoto = Boolean(pendingAvatar) || (Boolean(avatarPath) && !removingAvatar);
  // The photo is not in here, and that is the whole change: Teams asks for a
  // name and a country.
  const canSubmit = username.trim().length > 0 && Boolean(normalizeCountryCode(countryCode));

  const messageFor = (problem: ReturnType<typeof validateUsername>) => {
    switch (problem) {
      case "too_short":
        return copy.usernameTooShort;
      case "too_long":
        return copy.usernameTooLong;
      case "invalid_characters":
        return copy.usernameInvalid;
      case "reserved":
        return copy.usernameReserved;
      case "not_allowed":
        return copy.usernameNotAllowed;
      default:
        return null;
    }
  };

  const onChoosePhoto = async () => {
    setError(null);
    setPermissionBlocked(null);
    setStage("preparing");

    const outcome = await pickAndCompressAvatar();

    setStage("idle");

    if (outcome.status === "cancelled") {
      return;
    }

    if (outcome.status === "permission_denied") {
      // canAskAgain false means the OS will never show the dialog again, so a
      // Retry button would do nothing at all and Settings is the only route.
      setPermissionBlocked(outcome.canAskAgain ? "retry" : "settings");
      setError(copy.avatarPermissionBody);
      return;
    }

    if (outcome.status === "too_large") {
      setError(copy.avatarTooLarge);
      return;
    }

    if (outcome.status === "failed") {
      setError(copy.avatarFailed);
      return;
    }

    setRemovingAvatar(false);
    setPendingAvatar({ uri: outcome.uri, base64: outcome.base64, bytes: outcome.bytes });
  };

  const onRemovePhoto = () => {
    setError(null);
    setPermissionBlocked(null);
    setPendingAvatar(null);
    // Nothing is deleted yet. The bucket object goes only after the profile row
    // has stopped pointing at it, on Save, in that order — so abandoning this
    // screen leaves the reader's photo exactly where it was.
    setRemovingAvatar(true);
  };

  const onSave = async () => {
    if (!user?.id) {
      return;
    }

    const localProblem = validateUsername(username);

    if (localProblem) {
      setError(messageFor(localProblem));
      return;
    }

    const normalizedCountry = normalizeCountryCode(countryCode);

    if (!normalizedCountry) {
      setError(copy.countryRequired);
      return;
    }

    setError(null);

    // A courtesy check so the common case reads well. It is NOT the guard: the
    // write below is, and it can still refuse with 23505.
    if (username.trim() !== (profile.username ?? "")) {
      setStage("saving");
      const availability = await isUsernameAvailable(username.trim());

      if (availability.ok && !availability.data) {
        setStage("idle");
        setError(copy.usernameTaken);
        return;
      }
    }

    let storedPath = removingAvatar ? null : avatarPath;

    if (pendingAvatar) {
      setStage("uploading");

      const upload = await uploadAvatar({
        userId: user.id,
        base64: pendingAvatar.base64,
        bytes: pendingAvatar.bytes
      });

      if (upload.status === "too_large") {
        setStage("idle");
        setError(copy.avatarTooLarge);
        return;
      }

      if (upload.status !== "uploaded") {
        setStage("idle");
        setError(copy.avatarFailed);
        return;
      }

      storedPath = upload.path;
    }

    setStage("saving");

    const result = await savePlayerIdentity({
      username: username.trim(),
      countryCode: normalizedCountry,
      avatarPath: storedPath,
      clearAvatar: removingAvatar && !pendingAvatar
    });

    setStage("idle");

    if (!result.ok) {
      // 23505 is the race: somebody claimed the name between the check and the
      // write. Reported as "taken", never swallowed.
      setError(result.error.code === "23505" ? copy.usernameTaken : copy.loadFailed);
      return;
    }

    // The old object, now that the row no longer points at it. Storage is 1GB
    // on the plan this runs on, and an avatar every reader changes a few times
    // would otherwise leave one 200KB file behind per change, forever.
    //
    // AFTER the save, never before, and never awaited: if the profile write had
    // failed we would have deleted the picture the reader still has, and if the
    // delete fails the only cost is an orphan that account deletion sweeps by
    // folder.
    const replaced = avatarPath;

    if (replaced && replaced !== result.data.avatarPath) {
      void deleteAvatarObject(replaced);
    }

    setAvatarPath(result.data.avatarPath);
    setPendingAvatar(null);
    setRemovingAvatar(false);
    onCompleted(result.data);
  };

  const submitting = stage === "uploading" || stage === "saving";
  const submitText =
    stage === "uploading"
      ? copy.avatarUploading
      : stage === "saving"
        ? copy.savingProfile
        : (submitLabel ?? copy.saveProfile);

  return (
    <Card padding="lg" style={styles.card}>
      <View style={styles.preview}>
        {/* The photo just chosen wins over the stored one: it is a local file
            URI, nothing has been sent yet, and the reader has to see what they
            picked before committing to it. */}
        {pendingAvatar ? (
          <Image
            accessibilityIgnoresInvertColors
            accessible={false}
            source={{ uri: pendingAvatar.uri }}
            style={styles.pendingImage}
          />
        ) : (
          // removingAvatar shows the grey placeholder immediately, so "Remove"
          // is visibly answered before the save rather than after it.
          <PlayerAvatar
            avatarPath={removingAvatar ? null : avatarPath}
            name={username || null}
            size="hero"
          />
        )}

        <View style={styles.avatarMeta}>
          <AppText color="muted" variant="caption">
            {`${copy.avatarLabel} · ${copy.avatarOptional}`}
          </AppText>
          <AppText color="mutedSoft" variant="caption">
            {copy.avatarHelp}
          </AppText>
        </View>

        <SecondaryButton
          disabled={busy}
          label={stage === "preparing" ? copy.avatarPreparing : hasPhoto ? copy.avatarChange : copy.avatarChoose}
          onPress={() => void onChoosePhoto()}
        />

        {hasPhoto ? (
          <SecondaryButton disabled={busy} label={copy.avatarRemove} onPress={onRemovePhoto} />
        ) : null}

        {permissionBlocked === "settings" ? (
          <SecondaryButton
            label={copy.avatarPermissionOpenSettings}
            onPress={() => void Linking.openSettings()}
          />
        ) : null}
        {permissionBlocked === "retry" ? (
          <SecondaryButton
            label={copy.avatarPermissionRetry}
            onPress={() => void onChoosePhoto()}
          />
        ) : null}
      </View>

      <View style={styles.field}>
        <AppText color="muted" variant="caption">
          {copy.usernameLabel}
        </AppText>
        <TextInput
          accessibilityLabel={copy.usernameLabel}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          onChangeText={(value) => {
            setUsername(value);
            setError(null);
          }}
          placeholder={copy.usernamePlaceholder}
          placeholderTextColor={colors.mutedSoft}
          style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
          value={username}
        />
      </View>

      <View style={styles.field}>
        <AppText color="muted" variant="caption">
          {copy.countryLabel}
        </AppText>

        {selectedCountry && !pickingCountry ? (
          <PressableSurface
            accessibilityLabel={`${copy.countrySelected}: ${countryName(selectedCountry, language)}`}
            onPress={() => {
              setPickingCountry(true);
              setCountryQuery("");
            }}
            variant="row"
          >
            <View style={styles.countryRow}>
              <AppText variant="bodyStrong">{countryName(selectedCountry, language)}</AppText>
              <AppText color="muted" variant="caption">
                {`${selectedCountry.code} · ${copy.countryChange}`}
              </AppText>
            </View>
          </PressableSurface>
        ) : (
          <>
            <TextInput
              accessibilityLabel={copy.countryLabel}
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={setCountryQuery}
              placeholder={copy.countryPlaceholder}
              placeholderTextColor={colors.mutedSoft}
              style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
              value={countryQuery}
            />

            {countryResults.length === 0 ? (
              <AppText color="muted" variant="caption">
                {copy.countryNoResults}
              </AppText>
            ) : (
              <View style={styles.countryList}>
                {countryResults.slice(0, COUNTRY_RESULT_LIMIT).map((country) => (
                  <PressableSurface
                    accessibilityLabel={`${countryName(country, language)}, ${country.code}`}
                    key={country.code}
                    onPress={() => {
                      setCountryCode(country.code);
                      setPickingCountry(false);
                      setCountryQuery("");
                      setError(null);
                    }}
                    variant="row"
                  >
                    <View style={styles.countryRow}>
                      <AppText variant="body">{countryName(country, language)}</AppText>
                      <AppText color="muted" variant="caption">
                        {country.code}
                      </AppText>
                    </View>
                  </PressableSurface>
                ))}
                {countryResults.length > COUNTRY_RESULT_LIMIT ? (
                  <AppText color="mutedSoft" variant="caption">
                    {copy.countryMoreResults(countryResults.length - COUNTRY_RESULT_LIMIT)}
                  </AppText>
                ) : null}
              </View>
            )}
          </>
        )}
      </View>

      {error ? (
        // accessibilityLiveRegion so a screen reader announces the refusal
        // instead of leaving it to be discovered by swiping back up the form.
        <AppText
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          color="danger"
          variant="body"
        >
          {error}
        </AppText>
      ) : null}

      <PrimaryButton
        disabled={busy || !canSubmit}
        label={submitText}
        loading={submitting}
        onPress={() => void onSave()}
      />
    </Card>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      gap: tokens.space.lg
    },
    preview: {
      alignItems: "center",
      gap: tokens.space.sm
    },
    avatarMeta: {
      alignItems: "center",
      gap: tokens.space.xs
    },
    field: {
      gap: tokens.space.sm
    },
    input: {
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      fontSize: tokens.typography.size.body,
      // Vertical padding, not a fixed height: the field grows with Dynamic Type
      // and still clears 44pt at the default size.
      minHeight: 48,
      paddingHorizontal: tokens.space.md,
      paddingVertical: tokens.space.md
    },
    countryList: {
      gap: tokens.space.xs
    },
    countryRow: {
      gap: tokens.space.xs,
      minHeight: 44,
      justifyContent: "center"
    },
    pendingImage: {
      borderColor: c.border,
      borderRadius: tokens.radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      height: 96,
      width: 96
    }
  });

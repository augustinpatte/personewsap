import { useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { usePressedSurfaceStyle } from "../../design/usePressedSurfaceStyle";
import { useAuth } from "../auth";
import { ModuleScroll } from "../modules";
import { COUNTRIES, searchCountries } from "./countries";
import { initialsFor, normalizeCountryCode, validateUsername } from "./playerProfile";
import type { PlayerProfile } from "./playerProfile";
import { getTeamsCopy } from "./teamsCopy";
import { isUsernameAvailable, savePlayerIdentity } from "./teamsData";

/**
 * The one thing Teams asks for before it will show you a leaderboard.
 *
 * A username and a country. Not an avatar — a row renders initials perfectly
 * well, and a photo-library permission prompt in front of somebody who is trying
 * to join their friends' league is a wall, not an onboarding step. The avatar is
 * offered afterwards, in Account.
 *
 * Nothing about this gate reaches the rest of the app. A reader who closes it
 * still has their Newsletter, their Mini Cases, their Stories, their Path, their
 * archive and their Settings, exactly as before, with `profiles.username` still
 * NULL.
 *
 * VALIDATION IS TWO-LAYERED AND THE LAYERS HAVE DIFFERENT JOBS. The local check
 * gives a fast, well-worded refusal for shape problems. The server decides
 * uniqueness, in the same statement that writes — so two readers racing for
 * "augustin" cannot both win, and the loser is told so rather than silently
 * overwriting.
 */
export function TeamProfileGate({
  onCompleted,
  profile
}: {
  onCompleted: () => void;
  profile: PlayerProfile;
}) {
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const pressedSurface = usePressedSurfaceStyle();
  const { profileLanguage } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);

  const [username, setUsername] = useState(profile.username ?? "");
  const [countryCode, setCountryCode] = useState(profile.countryCode ?? "");
  const [countryQuery, setCountryQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const countryResults = useMemo(
    () => searchCountries(countryQuery, language).slice(0, 6),
    [countryQuery, language]
  );

  const selectedCountry = COUNTRIES.find((entry) => entry.code === countryCode) ?? null;

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

  const onSave = async () => {
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

    setSaving(true);
    setError(null);

    // A courtesy check so the common case reads well. It is NOT the guard: the
    // write below is, and it can still refuse.
    const availability = await isUsernameAvailable(username.trim());

    if (availability.ok && !availability.data) {
      setSaving(false);
      setError(copy.usernameTaken);
      return;
    }

    const result = await savePlayerIdentity({
      username: username.trim(),
      countryCode: normalizedCountry
    });

    setSaving(false);

    if (!result.ok) {
      // 23505 is the race: somebody claimed the name between the check and the
      // write. Reported as "taken", never swallowed.
      setError(result.error.code === "23505" ? copy.usernameTaken : copy.loadFailed);
      return;
    }

    onCompleted();
  };

  return (
    <ModuleScroll contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="title">{copy.profileTitle}</AppText>
        <AppText color="muted" variant="body">
          {copy.profileBody}
        </AppText>
      </View>

      <Card padding="lg" style={styles.card}>
        <View style={styles.preview}>
          <View style={styles.avatar}>
            <AppText color="accentInk" variant="subtitle">
              {initialsFor(username || null)}
            </AppText>
          </View>
          <AppText color="muted" variant="caption">
            {copy.avatarOptional}
          </AppText>
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
          {selectedCountry ? (
            <SecondaryButton
              label={`${selectedCountry.code} — ${
                language === "fr" ? selectedCountry.nameFr : selectedCountry.nameEn
              }`}
              onPress={() => {
                setCountryCode("");
                setCountryQuery("");
              }}
            />
          ) : (
            <>
              <TextInput
                accessibilityLabel={copy.countryLabel}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setCountryQuery}
                placeholder={copy.countryPlaceholder}
                placeholderTextColor={colors.mutedSoft}
                style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
                value={countryQuery}
              />
              <View style={styles.countryList}>
                {countryResults.map((country) => (
                  <SecondaryButton
                    key={country.code}
                    label={`${country.code} — ${
                      language === "fr" ? country.nameFr : country.nameEn
                    }`}
                    onPress={() => {
                      setCountryCode(country.code);
                      setError(null);
                    }}
                    style={pressedSurface ? undefined : undefined}
                  />
                ))}
              </View>
            </>
          )}
        </View>

        {error ? (
          <AppText color="danger" variant="body">
            {error}
          </AppText>
        ) : null}

        <PrimaryButton
          disabled={saving}
          label={saving ? copy.savingProfile : copy.saveProfile}
          loading={saving}
          onPress={() => void onSave()}
        />
      </Card>
    </ModuleScroll>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    content: {
      gap: tokens.space.xl
    },
    header: {
      gap: tokens.space.sm
    },
    card: {
      gap: tokens.space.lg
    },
    preview: {
      alignItems: "center",
      gap: tokens.space.sm
    },
    avatar: {
      alignItems: "center",
      backgroundColor: c.accentSoft,
      borderColor: c.accent,
      borderRadius: tokens.radius.pill,
      borderWidth: 1,
      height: 64,
      justifyContent: "center",
      width: 64
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
    }
  });

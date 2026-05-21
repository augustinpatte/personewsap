import type { NormalizedSupabaseError } from "./supabase";
import { localized } from "./i18n";
import type { Language } from "../types/domain";

export type ErrorSurface =
  | "account"
  | "auth"
  | "library"
  | "notification"
  | "onboarding"
  | "password"
  | "preferences"
  | "today";

type UserFacingError = {
  message: string;
  title: string;
};

export function getUserFacingError(
  error: NormalizedSupabaseError | null | undefined,
  language: Language | null | undefined,
  surface: ErrorSurface
): UserFacingError {
  const code = error?.code?.toLowerCase() ?? "";
  const message = error?.message?.toLowerCase() ?? "";

  if (isConfigError(code)) {
    return copy(language).liveUnavailable;
  }

  if (isNetworkError(code, message)) {
    return copy(language).network;
  }

  if (isSessionError(code, message)) {
    return copy(language).sessionExpired;
  }

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return copy(language).invalidCredentials;
  }

  if (message.includes("email not confirmed") || code.includes("email_not_confirmed")) {
    return copy(language).emailConfirmationRequired;
  }

  if (message.includes("already registered") || code.includes("already_registered")) {
    return copy(language).emailAlreadyRegistered;
  }

  if (code === "password_mismatch") {
    return copy(language).passwordMismatch;
  }

  if (message.includes("password should be") || message.includes("weak password")) {
    return copy(language).weakPassword;
  }

  if (message.includes("rate limit") || message.includes("too many requests")) {
    return copy(language).rateLimited;
  }

  if (code === "missing_topics" || code === "incomplete_onboarding") {
    return copy(language).missingPreferences;
  }

  if (surface === "onboarding" || surface === "preferences") {
    return copy(language).preferencesSaveFailed;
  }

  if (surface === "today" || surface === "library") {
    return copy(language).contentLoadFailed;
  }

  if (surface === "notification") {
    return copy(language).notificationFailed;
  }

  if (surface === "password") {
    return copy(language).passwordActionFailed;
  }

  return copy(language).generic;
}

export function getUserFacingErrorMessage(
  error: NormalizedSupabaseError | null | undefined,
  language: Language | null | undefined,
  surface: ErrorSurface
) {
  return getUserFacingError(error, language, surface).message;
}

function isConfigError(code: string) {
  return (
    code === "missing_supabase_config" ||
    code === "placeholder_supabase_config" ||
    code === "invalid_supabase_url"
  );
}

function isNetworkError(code: string, message: string) {
  return (
    code.includes("network") ||
    code.includes("timeout") ||
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("offline") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("load failed")
  );
}

function isSessionError(code: string, message: string) {
  return (
    code.includes("session") ||
    code.includes("refresh_token") ||
    message.includes("session expired") ||
    message.includes("auth session missing") ||
    message.includes("invalid refresh token") ||
    message.includes("jwt expired")
  );
}

function copy(language: Language | null | undefined) {
  return localized(
    {
      en: {
        contentLoadFailed: {
          title: "Could not load content",
          message: "We could not load your latest content right now. Please try again."
        },
        emailAlreadyRegistered: {
          title: "Account already exists",
          message: "An account already exists for this email. Log in instead, or reset your password."
        },
        emailConfirmationRequired: {
          title: "Confirm your email",
          message: "Please confirm your email before logging in."
        },
        generic: {
          title: "Something went wrong",
          message: "Something went wrong. Please try again."
        },
        invalidCredentials: {
          title: "Login failed",
          message: "The email or password is incorrect."
        },
        liveUnavailable: {
          title: "Account features unavailable",
          message: "Account features are unavailable right now. Please try again later."
        },
        missingPreferences: {
          title: "Preferences incomplete",
          message: "Choose at least one newsletter category before saving."
        },
        network: {
          title: "Connection problem",
          message: "The network is unavailable right now. Check your connection and try again."
        },
        notificationFailed: {
          title: "Reminder not saved",
          message: "We could not save reminder settings right now. Please try again."
        },
        passwordActionFailed: {
          title: "Password update failed",
          message: "We could not update your password right now. Please try again."
        },
        passwordMismatch: {
          title: "Passwords do not match",
          message: "Passwords do not match."
        },
        preferencesSaveFailed: {
          title: "Preferences not saved",
          message: "We could not save your preferences right now. Please try again."
        },
        rateLimited: {
          title: "Too many attempts",
          message: "Too many attempts. Wait a moment, then try again."
        },
        sessionExpired: {
          title: "Session expired",
          message: "Your session has expired. Please log in again."
        },
        weakPassword: {
          title: "Password too weak",
          message: "Choose a stronger password with at least 8 characters."
        }
      },
      fr: {
        contentLoadFailed: {
          title: "Chargement impossible",
          message: "Impossible de charger ton dernier contenu pour le moment. Réessaie."
        },
        emailAlreadyRegistered: {
          title: "Compte déjà existant",
          message: "Un compte existe déjà avec cet email. Connecte-toi ou réinitialise ton mot de passe."
        },
        emailConfirmationRequired: {
          title: "Confirme ton email",
          message: "Confirme ton email avant de te connecter."
        },
        generic: {
          title: "Une erreur est survenue",
          message: "Une erreur est survenue. Réessaie."
        },
        invalidCredentials: {
          title: "Connexion impossible",
          message: "L'email ou le mot de passe est incorrect."
        },
        liveUnavailable: {
          title: "Fonctions du compte indisponibles",
          message: "Les fonctions de compte sont indisponibles pour le moment. Réessaie plus tard."
        },
        missingPreferences: {
          title: "Préférences incomplètes",
          message: "Choisis au moins une catégorie newsletter avant d'enregistrer."
        },
        network: {
          title: "Problème de connexion",
          message: "Le réseau est indisponible pour le moment. Vérifie ta connexion et réessaie."
        },
        notificationFailed: {
          title: "Rappel non enregistré",
          message: "Impossible d'enregistrer les réglages de rappel pour le moment. Réessaie."
        },
        passwordActionFailed: {
          title: "Mot de passe non mis à jour",
          message: "Impossible de mettre à jour ton mot de passe pour le moment. Réessaie."
        },
        passwordMismatch: {
          title: "Mots de passe différents",
          message: "Les mots de passe ne correspondent pas."
        },
        preferencesSaveFailed: {
          title: "Préférences non enregistrées",
          message: "Impossible d'enregistrer tes préférences pour le moment. Réessaie."
        },
        rateLimited: {
          title: "Trop de tentatives",
          message: "Trop de tentatives. Attends un instant, puis réessaie."
        },
        sessionExpired: {
          title: "Session expirée",
          message: "Ta session a expiré. Connecte-toi à nouveau."
        },
        weakPassword: {
          title: "Mot de passe trop faible",
          message: "Choisis un mot de passe plus solide avec au moins 8 caractères."
        }
      }
    },
    language
  );
}

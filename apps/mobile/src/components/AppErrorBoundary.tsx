import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { tokens } from "../design/tokens";
import { localized } from "../lib/i18n";
import type { Language } from "../types/domain";
import { AppText } from "./AppText";
import { PrimaryButton } from "./PrimaryButton";

type AppErrorBoundaryState = {
  error: Error | null;
};

type AppErrorBoundaryProps = PropsWithChildren<{
  language?: Language | null;
}>;

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[Mobile screen error]", {
      message: error.message,
      componentStack: info.componentStack
    });
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    const copy = localized(
      {
        en: {
          eyebrow: "App recovery",
          title: "Something did not load cleanly.",
          description: "Your account is still safe. Reset this screen and try again.",
          reset: "Reset screen"
        },
        fr: {
          eyebrow: "Récupération",
          title: "Quelque chose ne s'est pas chargé correctement.",
          description: "Ton compte est toujours protégé. Réinitialise cet écran et réessaie.",
          reset: "Réinitialiser l'écran"
        }
      },
      getBoundaryLanguage(this.props)
    );

    return (
      <View style={styles.container}>
        <View style={styles.copy}>
          <AppText variant="eyebrow">{copy.eyebrow}</AppText>
          <AppText align="center" variant="title">
            {copy.title}
          </AppText>
          <AppText align="center" color="muted" variant="body">
            {copy.description}
          </AppText>
        </View>
        <PrimaryButton label={copy.reset} onPress={this.reset} />
      </View>
    );
  }
}

function getBoundaryLanguage(props: AppErrorBoundaryProps): Language | null {
  return props.language === "fr" || props.language === "en" ? props.language : null;
}

const styles = StyleSheet.create({
  container: {
    alignItems: "stretch",
    backgroundColor: tokens.color.background,
    flex: 1,
    gap: tokens.space.xl,
    justifyContent: "center",
    padding: tokens.space.xl
  },
  copy: {
    alignItems: "center",
    gap: tokens.space.sm
  }
});

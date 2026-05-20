import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { tokens } from "../design/tokens";
import { AppText } from "./AppText";
import { PrimaryButton } from "./PrimaryButton";

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
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

    return (
      <View style={styles.container}>
        <View style={styles.copy}>
          <AppText variant="eyebrow">App recovery</AppText>
          <AppText align="center" variant="title">
            Something did not load cleanly.
          </AppText>
          <AppText align="center" color="muted" variant="body">
            Your account is still safe. Reset this screen and try again.
          </AppText>
        </View>
        <PrimaryButton label="Reset screen" onPress={this.reset} />
      </View>
    );
  }
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

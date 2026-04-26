import type { PropsWithChildren } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { tokens } from "../design/tokens";

type AppScreenProps = PropsWithChildren<{
  centered?: boolean;
  padded?: boolean;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  safeAreaStyle?: StyleProp<ViewStyle>;
  scrollViewProps?: Omit<ScrollViewProps, "contentContainerStyle" | "children">;
}>;

function AppScreenRoot({
  centered = false,
  padded = true,
  scroll = true,
  contentStyle,
  safeAreaStyle,
  scrollViewProps,
  children
}: AppScreenProps) {
  const contentStyles = [
    styles.content,
    padded && styles.padded,
    centered && styles.centered,
    contentStyle
  ];

  return (
    <SafeAreaView style={[styles.safeArea, safeAreaStyle]}>
      {scroll ? (
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          {...scrollViewProps}
          contentContainerStyle={contentStyles}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={contentStyles}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type AppScreenHeaderProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
}>;

export function AppScreenHeader({ children, style }: AppScreenHeaderProps) {
  return <View style={[styles.header, style]}>{children}</View>;
}

type AppScreenBodyProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
}>;

export function AppScreenBody({ children, style }: AppScreenBodyProps) {
  return <View style={[styles.body, style]}>{children}</View>;
}

type AppScreenFooterProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
}>;

export function AppScreenFooter({ children, style }: AppScreenFooterProps) {
  return (
    <View style={[styles.footer, style]} pointerEvents="box-none">
      {children}
    </View>
  );
}

export const AppScreen = Object.assign(AppScreenRoot, {
  Header: AppScreenHeader,
  Body: AppScreenBody,
  Footer: AppScreenFooter
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.color.background
  },
  content: {
    flexGrow: 1,
    gap: tokens.space.xl
  },
  padded: {
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.xl
  },
  centered: {
    justifyContent: "center"
  },
  header: {
    gap: tokens.space.sm
  },
  body: {
    gap: tokens.space.lg
  },
  footer: {
    gap: tokens.space.md,
    paddingTop: tokens.space.sm
  }
});

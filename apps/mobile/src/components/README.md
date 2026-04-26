# Mobile UI Foundation

Use these components for shared PersoNewsAP mobile screens before adding feature-specific UI.

```tsx
import { AppScreen, Card, AppText, PrimaryButton } from "@/components";

export function ExampleScreen() {
  return (
    <AppScreen>
      <AppScreen.Header>
        <AppText variant="eyebrow">Today</AppText>
        <AppText variant="title">Your daily drop</AppText>
      </AppScreen.Header>

      <Card>
        <AppText variant="body">One focused briefing, no feed.</AppText>
      </Card>

      <PrimaryButton label="Start" onPress={() => {}} />
    </AppScreen>
  );
}
```

Keep feature logic outside this layer. Pass display text, progress values, and actions in from screens or feature modules.

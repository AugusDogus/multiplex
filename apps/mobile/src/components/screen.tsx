import type { ReactNode } from "react";

import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "~/components/text";

export function Screen({
  title,
  subtitle,
  children,
  scroll = true,
  testID,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
  testID?: string;
}) {
  const content = (
    <View className={`${scroll ? "" : "flex-1"} gap-6 px-4 pt-3 pb-12`}>
      {title ? (
        <View className="gap-1">
          <Text
            className="text-3xl font-bold tracking-tight"
            testID={testID ? `${testID}-title` : undefined}
          >
            {title}
          </Text>
          {subtitle ? <Text className="text-muted text-sm">{subtitle}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );

  return (
    <SafeAreaView className="bg-background" edges={["top"]} style={{ flex: 1 }} testID={testID}>
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      ) : (
        <View className="flex-1">{content}</View>
      )}
    </SafeAreaView>
  );
}

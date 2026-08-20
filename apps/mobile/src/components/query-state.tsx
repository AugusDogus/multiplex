import type { ReactNode } from "react";

import { ActivityIndicator, View } from "react-native";
import { Button } from "heroui-native/button";

import { Text } from "~/components/text";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <View className="items-center justify-center gap-3 py-14">
      <ActivityIndicator />
      <Text className="text-muted text-sm">{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <View className="bg-surface items-center gap-2 rounded-3xl px-6 py-10">
      <Text className="text-center text-lg font-semibold">{title}</Text>
      <Text className="text-muted text-center text-sm leading-5">{message}</Text>
      {action ? <View className="mt-3">{action}</View> : null}
    </View>
  );
}

export function ErrorState({
  message = "This content could not be loaded.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      title="Something went wrong"
      message={message}
      action={
        onRetry ? (
          <Button size="sm" onPress={onRetry}>
            Try again
          </Button>
        ) : null
      }
    />
  );
}

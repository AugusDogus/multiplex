import type { PlaylistType } from "@multiplex/plex-query";

const QUEUE_ACTION_REQUIRES_PLAYER =
  "Start playback first to add items to the active queue.";
const QUEUE_ACTION_PENDING = "Updating the active Plex queue.";
const QUEUE_ACTION_UNSUPPORTED =
  "Photo items cannot be added to the active playback queue.";
const QUEUE_ACTION_INCOMPATIBLE =
  "This item does not match the active playback queue's media type.";

export interface QueueActionContext {
  targetType: PlaylistType | undefined;
  activeType: PlaylistType | undefined;
  hasActiveQueue: boolean;
  isSameServer: boolean;
  hasServerConnection: boolean;
  isPending: boolean;
}

export function getQueueActionDisabledReason(
  context: QueueActionContext,
): string | undefined {
  if (context.targetType === "photo") {
    return QUEUE_ACTION_UNSUPPORTED;
  }

  if (
    !context.targetType ||
    !context.activeType ||
    !context.hasActiveQueue ||
    !context.isSameServer ||
    !context.hasServerConnection
  ) {
    return QUEUE_ACTION_REQUIRES_PLAYER;
  }

  if (context.targetType !== context.activeType) {
    return QUEUE_ACTION_INCOMPATIBLE;
  }

  if (context.isPending) {
    return QUEUE_ACTION_PENDING;
  }

  return undefined;
}

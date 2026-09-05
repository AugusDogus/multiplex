import type { ItemMetadata } from "@multiplex/plex-query";

export type SelectableStreamKind = "audio" | "subtitle";

const streamTypeFor = (kind: SelectableStreamKind): 2 | 3 =>
  kind === "audio" ? 2 : 3;

/**
 * Apply a stream selection to already-expanded metadata. Guest playback
 * cannot mutate Plex profile state or refresh through signed-in tRPC, so its
 * explicit playback URL and canonical player item stay local to the guest.
 */
export function applySelectedStream(
  item: ItemMetadata,
  kind: SelectableStreamKind,
  selectedStreamId: number | null,
): ItemMetadata {
  const targetStreamType = streamTypeFor(kind);

  return {
    ...item,
    Media: item.Media?.map((media) => ({
      ...media,
      Part: media.Part?.map((part) => ({
        ...part,
        Stream: part.Stream?.map((stream) =>
          stream.streamType === targetStreamType
            ? {
                ...stream,
                selected:
                  selectedStreamId !== null && stream.id === selectedStreamId,
              }
            : stream,
        ),
      })),
    })),
  };
}

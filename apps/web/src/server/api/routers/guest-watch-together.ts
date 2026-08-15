import { TRPCError } from "@trpc/server";
import {
  buildLibraryItemUri,
  parseLibraryItemUri,
  WatchTogetherClient,
} from "@multiplex/plex-query";
import { z } from "zod";

import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  enableGuestForCurrentHome,
  resolveGuestAccess,
  resolveGuestParty,
  toGuestShareEligibility,
  type GuestAccessFailureReason,
} from "~/server/watch-together/guest-access";
import { createGuestCapabilityCodec } from "~/server/watch-together/guest-capability";

const metadataRatingKeySchema = z.string().regex(/^\d+$/);
const metadataKeySchema = z
  .string()
  .regex(/^\/library\/metadata\/\d+$/)
  .optional();

let capabilityCodecPromise:
  | Promise<ReturnType<typeof createGuestCapabilityCodec>>
  | undefined;

function getCapabilityCodec() {
  capabilityCodecPromise ??= import("~/env").then(({ env }) =>
    createGuestCapabilityCodec(env.BETTER_AUTH_SECRET),
  );
  return capabilityCodecPromise;
}

export const guestWatchTogetherRouter = createTRPCRouter({
  hostContext: protectedProcedure
    .input(z.object({ capability: z.string().min(1).max(4_096) }))
    .query(async ({ ctx, input }) => {
      const verification = await (
        await getCapabilityCodec()
      ).verify(input.capability);
      if (
        !verification.ok ||
        verification.payload.hostUserId !== ctx.authSession.user.id
      ) {
        return { valid: false as const };
      }

      const payload = verification.payload;
      const watchTogether = new WatchTogetherClient(
        ctx.plex.getToken(),
        NEXTJS_PLEX_CONFIG,
      );
      try {
        const room = await watchTogether.getRoom(payload.roomId);
        const source = parseLibraryItemUri(room.sourceUri);
        if (!source) {
          return { valid: false as const };
        }
        const party = await resolveGuestParty(ctx.plex);
        if (!party.ok) {
          if (party.reason === "plex-unavailable") {
            throw new TRPCError({
              code: "SERVICE_UNAVAILABLE",
              message: "Plex Home membership could not be verified.",
            });
          }
          return { valid: false as const };
        }
        const roomUserIds = new Set(room.users.map((user) => user.id));
        if (
          room.id !== payload.roomId ||
          !roomUserIds.has(party.hostPlexUserId) ||
          !roomUserIds.has(party.guest.id)
        ) {
          return { valid: false as const };
        }
        return {
          valid: true as const,
          roomId: room.id,
          hostUserId: party.hostPlexUserId,
          guestUserId: party.guest.id,
          joinPath: `/watch-together/guest/${encodeURIComponent(input.capability)}`,
        };
      } catch (cause) {
        if (cause instanceof TRPCError) throw cause;
        return { valid: false as const };
      }
    }),

  continueHost: protectedProcedure
    .input(
      z.object({
        capability: z.string().min(1).max(4_096),
        roomId: z.string().regex(/^[A-Za-z0-9]+$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const codec = await getCapabilityCodec();
      const verification = await codec.verify(input.capability);
      if (
        !verification.ok ||
        verification.payload.hostUserId !== ctx.authSession.user.id
      ) {
        return { valid: false as const };
      }

      const watchTogether = new WatchTogetherClient(
        ctx.plex.getToken(),
        NEXTJS_PLEX_CONFIG,
      );
      try {
        const room = await watchTogether.getRoom(input.roomId);
        const source = parseLibraryItemUri(room.sourceUri);
        if (!source || room.id !== input.roomId) {
          return { valid: false as const };
        }
        const party = await resolveGuestParty(ctx.plex);
        if (!party.ok) {
          if (party.reason === "plex-unavailable") {
            throw new TRPCError({
              code: "SERVICE_UNAVAILABLE",
              message: "Plex Home membership could not be verified.",
            });
          }
          return { valid: false as const };
        }
        const roomUserIds = new Set(room.users.map((user) => user.id));
        if (
          !roomUserIds.has(party.hostPlexUserId) ||
          !roomUserIds.has(party.guest.id)
        ) {
          return { valid: false as const };
        }

        const remainingLifetime = Math.max(
          1,
          verification.payload.expiresAt - Math.floor(Date.now() / 1000),
        );
        const capability = await codec.sign({
          hostUserId: verification.payload.hostUserId,
          roomId: room.id,
          lifetimeSeconds: remainingLifetime,
        });
        return {
          valid: true as const,
          capability,
          roomId: room.id,
        };
      } catch (cause) {
        if (cause instanceof TRPCError) throw cause;
        return { valid: false as const };
      }
    }),

  eligibility: protectedProcedure
    .input(
      z.object({
        serverId: z.string().min(1),
        ratingKey: metadataRatingKeySchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      return toGuestShareEligibility(await resolveGuestAccess(ctx.plex, input));
    }),

  enableGuest: protectedProcedure.mutation(async ({ ctx }) => {
    return enableGuestForCurrentHome(ctx.plex);
  }),

  createLink: protectedProcedure
    .input(
      z.object({
        serverId: z.string().min(1),
        ratingKey: metadataRatingKeySchema,
        key: metadataKeySchema,
        title: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const resolution = await resolveGuestAccess(ctx.plex, input);
      if (!resolution.ok) {
        throw guestAccessError(resolution.reason);
      }

      const expectedSourceUri = buildLibraryItemUri(
        input.serverId,
        input.ratingKey,
        input.key,
      );
      const watchTogether = new WatchTogetherClient(
        ctx.plex.getToken(),
        NEXTJS_PLEX_CONFIG,
      );
      const room = await watchTogether.createRoom({
        sourceUri: expectedSourceUri,
        title: input.title,
        users: [resolution.value.guest.id],
      });

      const roomUserIds = new Set(room.users.map((user) => user.id));
      const validRoom =
        room.sourceUri === expectedSourceUri &&
        roomUserIds.has(resolution.value.hostPlexUserId) &&
        roomUserIds.has(resolution.value.guest.id);
      if (!validRoom) {
        await watchTogether.deleteRoom(room.id).catch(() => undefined);
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Plex created an invalid Guest room. Please try again.",
        });
      }

      try {
        const capability = await (
          await getCapabilityCodec()
        ).sign({
          hostUserId: ctx.authSession.user.id,
          roomId: room.id,
        });
        return {
          room,
          capability,
          joinPath: `/watch-together/guest/${encodeURIComponent(capability)}`,
          hostRoomPath: `/watch-together/${encodeURIComponent(room.id)}`,
        };
      } catch (cause) {
        await watchTogether.deleteRoom(room.id).catch(() => undefined);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to create a secure Guest link.",
          cause,
        });
      }
    }),
});

function guestAccessError(reason: GuestAccessFailureReason): TRPCError {
  const message = (() => {
    switch (reason) {
      case "guest-disabled":
        return "Enable Plex Home Guest before creating a Guest link.";
      case "guest-protected":
        return "Remove the Plex Home Guest PIN before creating a Guest link.";
      case "not-home-member":
        return "Your Plex account is not an eligible member of this Plex Home.";
      case "guest-switch-failed":
        return "Plex could not switch to the Home Guest profile.";
      case "server-unavailable":
        return "The Plex Home Guest cannot access this server.";
      case "item-unavailable":
        return "The Plex Home Guest cannot access this title.";
      case "plex-unavailable":
        return "Plex Guest access could not be verified right now.";
      default: {
        const exhaustive: never = reason;
        return exhaustive;
      }
    }
  })();

  return new TRPCError({ code: "PRECONDITION_FAILED", message });
}

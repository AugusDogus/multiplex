import { PlexTvClient } from "@multiplex/plex-query";

import { auth } from "~/lib/auth/server";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import { handlePlexImageRequest } from "~/server/plex-image";
import { getServersQuery } from "~/server/queries/get-servers";

export async function GET(request: Request): Promise<Response> {
  return handlePlexImageRequest(request, {
    authenticate: async (imageRequest) => {
      const session = await auth.api.getSession({
        headers: imageRequest.headers,
      });
      const token = session?.user.plexAuthToken;
      if (!token) {
        return null;
      }

      const plex = new PlexTvClient(token, NEXTJS_PLEX_CONFIG);
      return {
        token,
        servers: await getServersQuery(plex),
      };
    },
    fetch: globalThis.fetch,
  });
}

/**
 * Effect HttpApi mount at `/api/effect`.
 *
 * Designated Effect boundary: `HttpRouter.toWebHandler` builds a fetch-style
 * handler once at module scope (executor `toApiHandler` pattern).
 */
import { plexWebHandler } from "~/server/effect-api/handler";

const handler = (request: Request): Promise<Response> =>
  plexWebHandler.handler(request);

export {
  handler as DELETE,
  handler as GET,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};

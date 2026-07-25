import { type NextRequest } from "next/server";

import { gateDocumentSession } from "~/lib/auth/session-gate";

export function proxy(request: NextRequest) {
  return gateDocumentSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

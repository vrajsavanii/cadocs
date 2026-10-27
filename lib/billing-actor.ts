import { getSessionUser } from "@/lib/auth";
import { fail } from "@/lib/api";
import type { Actor } from "@/lib/invoicing";
import type { AuthUser } from "@/lib/types";

/**
 * Maps the trusted session user to a billing Actor. The role comes from the
 * server-side session only — a browser can never claim "partner".
 */
export function actorFrom(user: AuthUser): Actor {
  return { name: user.name, role: user.role };
}

export async function requireActor(): Promise<Actor | Response> {
  const user = await getSessionUser();
  if (!user) return fail("Sign in required", 401);
  return actorFrom(user);
}

export function notSignedIn() {
  return fail("Sign in required", 401);
}

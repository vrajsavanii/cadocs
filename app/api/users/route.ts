import { createUser, listUsers } from "@/lib/db";
import { handle, ok, readBody, str } from "@/lib/api";
import { pick } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Partner-only user administration (the proxy also blocks manager/article writes here). */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "partner") {
      return ok({ error: "Partner access only" }, 403);
    }
    return ok({ users: listUsers() });
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "partner") {
      return ok({ error: "Partner access only" }, 403);
    }
    const body = await readBody(req);
    const username = str(body.username, "Username", { max: 40 }).toLowerCase().trim();
    if (username.length < 3 || !/^[a-z0-9._-]+$/.test(username)) {
      return ok({ error: "Username needs 3+ characters: letters, numbers, dot, dash, underscore" }, 400);
    }
    const name = str(body.name, "Name", { max: 80 });
    const password = str(body.password, "Password", { max: 200 });
    if (name.trim().length < 2) return ok({ error: "Name is too short" }, 400);
    if (password.length < 8) return ok({ error: "Password must be at least 8 characters" }, 400);
    const created = createUser({
      username,
      name: name.trim(),
      email: str(body.email, "Email", { optional: true, max: 120 }),
      role: pick(body.role, ["partner", "manager", "article"] as const, "Role"),
      password,
    });
    return ok({ user: created });
  } catch (err) {
    return handle(err);
  }
}
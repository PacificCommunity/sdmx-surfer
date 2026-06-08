import { NextResponse } from "next/server";
import {
  verifyPassword,
  mintCookieValue,
  COOKIE,
  ensureAnonIdentity,
} from "@/lib/country-snapshots/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/countrysnapshots") || "/countrysnapshots";

  if (!verifyPassword(password)) {
    return NextResponse.redirect(
      new URL(
        `/countrysnapshots/login?error=1&next=${encodeURIComponent(next)}`,
        req.url,
      ),
      303,
    );
  }

  const { value, uid } = mintCookieValue();
  await ensureAnonIdentity(uid);
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.headers.set("Set-Cookie", COOKIE.serialize(value));
  return res;
}

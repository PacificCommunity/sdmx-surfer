import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, dashboardSessions } from "@/lib/db";
import { requireSnapshotSession } from "@/lib/country-snapshots/auth";
import {
  getSnapshotCatalogue,
  getCountry,
  getThemeBySlug,
  type Country,
} from "@/lib/country-snapshots/catalogue";
import { buildSnapshotConfig } from "@/lib/country-snapshots/config-builder";

/**
 * Fork a Country Snapshot into the authenticated Surfer space.
 *
 * Flow:
 *   1. Validate the snapshot cookie (the user must be in the snapshot area).
 *   2. Validate the country/theme params against the catalogue.
 *   3. If no authenticated Surfer session, redirect to /login with a `next`
 *      param that round-trips back to this endpoint after sign-in.
 *   4. Build the dashboard config from (countries, theme) and insert a new
 *      dashboard_sessions row owned by the real user, seeded with the
 *      config and a leading system note explaining the fork origin.
 *   5. Redirect into /builder?session=<id>.
 *
 * Accepts both GET (from a plain link) and POST (from a form). GET is the
 * common case because the overlay's "Explore in Surfer" link is a normal
 * anchor that lets the browser follow redirects, including the sign-in
 * round-trip.
 */
export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  const snap = await requireSnapshotSession();
  if (!snap) {
    return NextResponse.redirect(
      new URL("/countrysnapshots/login", req.url),
      303,
    );
  }

  const url = new URL(req.url);
  const countryParam = url.searchParams.get("country") ?? "";
  const themeSlug = url.searchParams.get("theme") ?? "";
  const codes = countryParam.split(",").map((c) => c.trim()).filter(Boolean);

  if (codes.length === 0 || codes.length > 5 || !themeSlug) {
    return NextResponse.json(
      { error: "missing or invalid country/theme" },
      { status: 400 },
    );
  }
  const theme = getThemeBySlug(themeSlug);
  const resolved = codes.map(getCountry);
  if (!theme || resolved.some((c) => !c)) {
    return NextResponse.json(
      { error: "unknown country or theme" },
      { status: 400 },
    );
  }
  const countries = resolved.filter((c): c is Country => Boolean(c));

  // Real Surfer auth required to own the forked session.
  const surferSession = await auth();
  if (!surferSession?.user?.userId) {
    // Round-trip the user through /login and back to this exact URL.
    const next = encodeURIComponent(req.url);
    return NextResponse.redirect(new URL(`/login?next=${next}`, req.url), 303);
  }

  const cat = getSnapshotCatalogue();
  const config = buildSnapshotConfig({
    country: countries.length === 1 ? countries[0] : countries,
    theme,
    catalogue: cat,
  });

  const title =
    countries.map((c) => c.name).join(" vs ") +
    " — " +
    theme.title +
    " (forked from snapshot)";
  const forkNote = {
    role: "system" as const,
    content:
      "This session was forked from a Country Snapshot for " +
      countries.map((c) => c.name).join(", ") +
      ", " +
      theme.title +
      ". Use update_dashboard to customise the visuals, time ranges, or add indicators.",
  };

  const [row] = await db
    .insert(dashboardSessions)
    .values({
      user_id: surferSession.user.userId,
      title,
      config_history: [config] as unknown as never,
      config_pointer: 0,
      messages: [forkNote] as unknown as never,
    })
    .returning();

  return NextResponse.redirect(
    new URL(`/builder?session=${row.id}`, req.url),
    303,
  );
}

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
import {
  buildSnapshotConfig,
  toNativeDashboardConfig,
} from "@/lib/country-snapshots/config-builder";

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
    // Round-trip through /login and back to this exact fork request. The
    // login page reads `callbackUrl` (not `next`) and its safety check
    // requires a same-origin path — so pass pathname+search, never the
    // absolute URL.
    const callbackUrl = encodeURIComponent(url.pathname + url.search);
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${callbackUrl}`, req.url),
      303,
    );
  }

  const cat = getSnapshotCatalogue();
  const snapshotConfig = buildSnapshotConfig({
    country: countries.length === 1 ? countries[0] : countries,
    theme,
    catalogue: cat,
  });
  // The builder loads, previews, and iterates on the NATIVE dashboard
  // schema — seeding the raw SnapshotConfig shape crashes its preview.
  const nativeConfig = toNativeDashboardConfig(snapshotConfig);

  const title =
    countries.map((c) => c.name).join(" vs ") +
    " — " +
    theme.title +
    " (forked from snapshot)";

  const omitted = snapshotConfig.items.filter(
    (i) => i.type === "text" || !i.dataUrl,
  );
  // The builder renders UIMessages: { id, role, parts: [...] }. A bare
  // { role, content } ModelMessage has no `parts` array and crashes
  // MessageBubble at message.parts.map.
  const forkNote = {
    id: crypto.randomUUID(),
    role: "assistant" as const,
    parts: [
      {
        type: "text" as const,
        text:
          "This session was forked from the Country Snapshot for **" +
          countries.map((c) => c.name).join(", ") +
          " — " +
          theme.title +
          "**. The dashboard on the right mirrors the snapshot" +
          (omitted.length > 0
            ? ` (${omitted.length} indicator${omitted.length === 1 ? " is" : "s are"} not included because they have no data here)`
            : "") +
          ". Ask me to customise it — change time ranges, add or drop indicators, switch chart types, or bring in other countries.",
      },
    ],
  };

  const [row] = await db
    .insert(dashboardSessions)
    .values({
      user_id: surferSession.user.userId,
      title,
      config_history: [nativeConfig] as unknown as never,
      config_pointer: 0,
      messages: [forkNote] as unknown as never,
    })
    .returning();

  return NextResponse.redirect(
    new URL(`/builder?session=${row.id}`, req.url),
    303,
  );
}

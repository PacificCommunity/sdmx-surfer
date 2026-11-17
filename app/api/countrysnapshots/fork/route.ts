import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkCsrf } from "@/lib/csrf";
import { db, dashboardSessions } from "@/lib/db";
import { loginPathWithCallback } from "@/lib/login-redirect";
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

const SNAPSHOT_ROOT = "/countrysnapshots";

/**
 * Fork a Country Snapshot into the authenticated Surfer space.
 *
 * Flow:
 *   1. Validate the country/theme form fields against the catalogue.
 *   2. If there is no Surfer session (the snapshot pages require one, but
 *      the session may have expired), redirect to /login with a
 *      `callbackUrl` pointing at the snapshot page the form was submitted
 *      from. A POST cannot be replayed after sign-in, so the visitor lands
 *      back on the snapshot and presses "Explore in Surfer" again.
 *   3. Build the dashboard config from (countries, theme) and insert a new
 *      dashboard_sessions row owned by the signed-in user, seeded with the
 *      config and a leading system note explaining the fork origin.
 *   4. Redirect into /builder?session=<id>.
 *
 * POST-only because it creates a row: a GET link could be triggered
 * cross-site (img tag, prefetch) to fill a signed-in user's sessions. The
 * overlay submits a plain form so the browser still follows the 303s.
 */
export async function POST(req: Request) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "missing or invalid country/theme" },
      { status: 400 },
    );
  }
  const countryParam = formString(form, "country");
  const themeSlug = formString(form, "theme");
  const codes = countryParam.split(",").map((c) => c.trim()).filter(Boolean);

  // Cap mirrors snapshotContextSchema's countryCodes max (30): regional pages
  // fork with the full MFAT-15 scope, so this must comfortably exceed it.
  if (codes.length === 0 || codes.length > 30 || !themeSlug) {
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

  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.redirect(
      new URL(
        loginPathWithCallback(snapshotReturnPath(formString(form, "returnTo"))),
        req.url,
      ),
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

  // Joining 15 country names with "vs" produces an unusable title; past a
  // handful, summarise by count instead.
  const countryLabel =
    countries.length <= 3
      ? countries.map((c) => c.name).join(" vs ")
      : countries.length + " Pacific countries";

  const title = countryLabel + " — " + theme.title + " (forked from snapshot)";

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
          (countries.length <= 5
            ? countries.map((c) => c.name).join(", ")
            : countries.length +
              " Pacific countries (" +
              countries.map((c) => c.code).join(", ") +
              ")") +
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
      user_id: session.user.userId,
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

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

// The sign-in round-trip may only land on a snapshot page: returnTo is
// client-supplied, and anything else falls back to the snapshot index.
function snapshotReturnPath(returnTo: string): string {
  const rest = returnTo.slice(SNAPSHOT_ROOT.length);
  return returnTo.startsWith(SNAPSHOT_ROOT) &&
    (rest === "" || rest.startsWith("/") || rest.startsWith("?"))
    ? returnTo
    : SNAPSHOT_ROOT;
}

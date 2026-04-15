import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, allowedEmails, authUsers, authVerificationTokens, usageLogs } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().email(),
});

// ---------------------------------------------------------------------------
// GET /api/admin/invites — list all allowed emails ordered by createdAt DESC
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const invites = await db
      .select()
      .from(allowedEmails)
      .orderBy(desc(allowedEmails.created_at));

    // Look up which invited emails have registered (have an auth_users record)
    const allUsers = await db
      .select({ email: authUsers.email, id: authUsers.id, createdAt: authUsers.created_at })
      .from(authUsers);
    const userMap = new Map(allUsers.map((u) => [u.email, u]));

    // Get last activity per user from usage_logs
    const lastActivityRows = await db
      .select({
        userId: usageLogs.user_id,
        lastActive: sql<string>`max(${usageLogs.created_at})`,
      })
      .from(usageLogs)
      .groupBy(usageLogs.user_id);
    const activityMap = new Map(lastActivityRows.map((r) => [r.userId, r.lastActive]));

    // Magic-link request activity per identifier. NextAuth stores `expires`
    // (= created_at + maxAge), so we surface max(expires) as a proxy for the
    // most recent request time. Tokens are deleted when the user successfully
    // signs in, so any remaining rows represent unused / stuck requests.
    const tokenRows = await db
      .select({
        identifier: authVerificationTokens.identifier,
        pending: sql<number>`count(*) filter (where ${authVerificationTokens.expires} > now())`,
        total: sql<number>`count(*)`,
        lastExpires: sql<string>`max(${authVerificationTokens.expires})`,
      })
      .from(authVerificationTokens)
      .groupBy(authVerificationTokens.identifier);
    const tokenMap = new Map(
      tokenRows.map((r) => [
        r.identifier.toLowerCase(),
        {
          pending: Number(r.pending),
          total: Number(r.total),
          lastExpires: r.lastExpires,
        },
      ]),
    );

    const enriched = invites.map((inv) => {
      const user = userMap.get(inv.email);
      const tokens = tokenMap.get(inv.email);
      return {
        email: inv.email,
        invited_by: inv.invited_by,
        created_at: inv.created_at,
        invite_email_sent: inv.invite_email_sent ?? false,
        signed_up: !!user,
        signed_up_at: user?.createdAt || null,
        last_active: user ? (activityMap.get(user.id) || null) : null,
        pending_magic_links: tokens?.pending ?? 0,
        total_magic_link_requests: tokens?.total ?? 0,
        last_link_expires_at: tokens?.lastExpires ?? null,
      };
    });

    return NextResponse.json({ invites: enriched });
  } catch (err) {
    console.error("[admin/invites] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/invites — add an email to the allowlist
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  const invitedBy = session.user.userId;

  try {
    await db
      .insert(allowedEmails)
      .values({ email, invited_by: invitedBy })
      .onConflictDoNothing();

    // Send invitation email via Resend (if configured)
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        const from = process.env.EMAIL_FROM || "noreply@example.com";
        const loginUrl = (process.env.NEXTAUTH_URL || "https://sdmx-surfer.vercel.app") + "/login";

        await resend.emails.send({
          from,
          to: email,
          subject: "You're invited to SDMX Surfer",
          html:
            '<div style="font-family: Inter, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px; color: #181c1e;">' +
            '<h2 style="color: #004467; margin: 0 0 16px;">You\'ve been invited!</h2>' +
            '<p style="line-height: 1.6; margin: 0 0 16px;">Hi,</p>' +
            '<p style="line-height: 1.6; margin: 0 0 24px;">' +
            "You've been invited to <strong>SDMX Surfer</strong>, an early-alpha tool built at the " +
            "<strong>Pacific Community (SPC)</strong> for exploring SDMX data through conversation. " +
            "Describe what you want to know, and an AI agent will find the data and build visualisations with you." +
            "</p>" +
            '<a href="' + loginUrl + '" style="display: inline-block; background: #004467; color: #fff; ' +
            'padding: 12px 24px; border-radius: 999px; text-decoration: none; font-weight: 600;">Sign in</a>' +
            '<p style="color: #6b7280; font-size: 12px; margin: 24px 0 0;">Sign in with this email address: <strong>' +
            email + "</strong></p>" +
            '<p style="line-height: 1.6; margin: 24px 0 0;">Happy surfing,<br>Giulio Valentino Dalla Riva<br>Pacific Community (SPC)</p>' +
            "</div>",
          text:
            "Hi,\n\n" +
            "You've been invited to SDMX Surfer, an early-alpha tool built at the Pacific Community (SPC) " +
            "for exploring SDMX data through conversation. Describe what you want to know, and an AI agent " +
            "will find the data and build visualisations with you.\n\n" +
            "Sign in: " + loginUrl + "\n" +
            "Use this email address to sign in: " + email + "\n\n" +
            "Happy surfing,\n" +
            "Giulio Valentino Dalla Riva\n" +
            "Pacific Community (SPC)\n",
        });

        // Mark invite email as sent
        await db
          .update(allowedEmails)
          .set({ invite_email_sent: true })
          .where(eq(allowedEmails.email, email));
      } catch (emailErr) {
        // Log but don't fail — the invite was created, email is a bonus
        console.error("[admin/invites] Failed to send invitation email:", emailErr);
      }
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

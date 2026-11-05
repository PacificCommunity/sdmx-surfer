import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, allowedDomains } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";
import { domainRuleProblem, normaliseDomain } from "@/lib/signup-policy";

/**
 * Institutional domains admitted without an invite.
 *
 * Adding a row here lets everyone at that organisation sign in, so this is the
 * widest-reaching control in the admin panel. It refuses consumer mail domains
 * outright: `gmail.com` looks like an ordinary row and would open the service
 * to anyone, and both `gmail.com` and `outlook.com` already appear among real
 * users, so it is a live mistake rather than a hypothetical one. Personal
 * addresses belong on the invite list, one at a time.
 */

// A hostname for an exact rule, or `.hostname` for a suffix rule admitting
// every strictly deeper subdomain. Not an address and not a `*` wildcard.
const domainSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(3)
    .max(253)
    .regex(
      /^(@|\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\.?$/i,
      "Must be a domain such as spc.int, or a suffix such as .govt.nz",
    ),
  organisation: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.userId) return { error: "Unauthorized", status: 401 as const };
  if (session.user.role !== "admin")
    return { error: "Forbidden", status: 403 as const };
  return { session };
}

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ error: gate.error }, { status: gate.status });

  const rows = await db
    .select()
    .from(allowedDomains)
    .orderBy(desc(allowedDomains.created_at));
  return NextResponse.json({ domains: rows });
}

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ error: gate.error }, { status: gate.status });

  // strict: adding a domain admits an entire organisation, so this sits in
  // the same tier as role and password writes and fails closed without an Origin.
  const csrf = checkCsrf(req, { strict: true });
  if (csrf) return csrf;

  const body = await req.json().catch(() => null);
  const parsed = domainSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid domain" },
      { status: 400 },
    );
  }

  const domain = normaliseDomain(parsed.data.domain);
  const problem = domainRuleProblem(domain);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  await db
    .insert(allowedDomains)
    .values({
      domain,
      organisation: parsed.data.organisation || null,
      note: parsed.data.note || null,
      added_by: gate.session.user.userId,
    })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true, domain });
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ error: gate.error }, { status: gate.status });

  // strict: adding a domain admits an entire organisation, so this sits in
  // the same tier as role and password writes and fails closed without an Origin.
  const csrf = checkCsrf(req, { strict: true });
  if (csrf) return csrf;

  const domain = normaliseDomain(
    new URL(req.url).searchParams.get("domain") ?? "",
  );
  if (!domain) {
    return NextResponse.json({ error: "missing domain" }, { status: 400 });
  }

  // Removing a domain does not sign anyone out or delete their account; it
  // stops NEW people from that organisation signing up.
  await db.delete(allowedDomains).where(eq(allowedDomains.domain, domain));
  return NextResponse.json({ ok: true });
}

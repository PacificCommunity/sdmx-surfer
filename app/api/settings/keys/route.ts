import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, userApiKeys } from "@/lib/db";
import { encryptApiKey } from "@/lib/encryption";

// ---------------------------------------------------------------------------
// Input validation schemas
// ---------------------------------------------------------------------------

const providerEnum = z.enum(["anthropic", "openai", "google"]);

const addKeySchema = z.object({
  provider: providerEnum,
  apiKey: z.string().min(1),
  modelPreference: z.string().optional(),
});

const deleteKeySchema = z.object({
  provider: providerEnum,
});

// ---------------------------------------------------------------------------
// GET /api/settings/keys — list configured providers (no raw keys returned)
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.userId;

  try {
    const rows = await db
      .select({
        provider: userApiKeys.provider,
        modelPreference: userApiKeys.model_preference,
        updatedAt: userApiKeys.updated_at,
      })
      .from(userApiKeys)
      .where(eq(userApiKeys.user_id, userId));

    const keys = rows.map((row) => ({
      provider: row.provider,
      modelPreference: row.modelPreference,
      updatedAt: row.updatedAt,
    }));

    return NextResponse.json({ keys });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/settings/keys — add or update a BYOK key (encrypted at rest)
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = addKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { provider, apiKey, modelPreference } = parsed.data;

  try {
    const encryptedKey = encryptApiKey(apiKey, provider);

    await db
      .insert(userApiKeys)
      .values({
        user_id: userId,
        provider,
        encrypted_key: encryptedKey,
        model_preference: modelPreference ?? null,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [userApiKeys.user_id, userApiKeys.provider],
        set: {
          encrypted_key: encryptedKey,
          model_preference: modelPreference ?? null,
          updated_at: new Date(),
        },
      });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/settings/keys — remove a BYOK key
// ---------------------------------------------------------------------------

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = deleteKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { provider } = parsed.data;

  try {
    await db
      .delete(userApiKeys)
      .where(
        and(
          eq(userApiKeys.user_id, userId),
          eq(userApiKeys.provider, provider),
        ),
      );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

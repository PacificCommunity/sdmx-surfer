import { NextResponse } from "next/server";
import { requireSnapshotSession } from "@/lib/country-snapshots/auth";

export async function POST(req: Request) {
  const session = await requireSnapshotSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  let body: { indicator?: string; dataflow?: string; error?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!body.indicator) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  console.warn("[country-snapshots] indicator failure", {
    indicator: body.indicator,
    dataflow: body.dataflow,
    error: body.error?.slice(0, 200),
    uid: session.uid,
  });
  return NextResponse.json({ ok: true });
}

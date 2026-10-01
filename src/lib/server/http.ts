import "server-only";
import { NextResponse } from "next/server";
import { toPublicError } from "@/lib/errors";

/** Wraps a route handler so every failure becomes a safe `{ error }` JSON response. */
export async function respond(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    const { code, message, status } = toPublicError(err);
    return NextResponse.json({ error: { code, message } }, { status });
  }
}

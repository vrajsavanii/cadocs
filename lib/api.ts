import { NextRequest, NextResponse } from "next/server";

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Parsed JSON request body. Every field a handler reads goes through the
 * validators below, so the body is intentionally loosely typed here: the
 * validators are the trust boundary, not TypeScript's guess about the shape.
 */
export async function readBody(req: NextRequest | Request): Promise<Record<string, any>> {
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError("Expected a JSON object");
    }
    return parsed as Record<string, any>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError("Invalid JSON body");
  }
}

export async function readText(req: NextRequest | Request): Promise<string> {
  const text = await req.text();
  return text.trim();
}

export function ok(body: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function fail(message: string, status = 400): NextResponse {
  return ok({ error: message }, status);
}

export function pick<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const s = String(value ?? "");
  if (!allowed.includes(s as T)) {
    throw new HttpError(`"${field}" must be one of: ${allowed.join(", ")}`);
  }
  return s as T;
}

export function date(value: unknown, field: string, opts?: { optional?: boolean }): string {
  if (value === undefined || value === null || value === "") {
    if (opts?.optional) return "";
    throw new HttpError(`"${field}" is required`);
  }
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00`).getTime())) {
    throw new HttpError(`"${field}" must be a date in YYYY-MM-DD form`);
  }
  return s;
}

export function num(value: unknown, field: string, opts?: { optional?: boolean; min?: number; max?: number }): number {
  if (value === undefined || value === null || value === "") {
    if (opts?.optional) return 0;
    throw new HttpError(`"${field}" is required`);
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new HttpError(`"${field}" must be a number`);
  if (opts?.min !== undefined && n < opts.min) throw new HttpError(`"${field}" must be at least ${opts.min}`);
  if (opts?.max !== undefined && n > opts.max) throw new HttpError(`"${field}" must be at most ${opts.max}`);
  return n;
}

export function str(value: unknown, field: string, opts?: { optional?: boolean; max?: number }): string {
  if (value === undefined || value === null || value === "") {
    if (opts?.optional) return "";
    throw new HttpError(`"${field}" is required`);
  }
  if (typeof value !== "string" && typeof value !== "number") throw new HttpError(`"${field}" must be text`);
  const trimmed = String(value).trim();
  if (!opts?.optional && !trimmed) throw new HttpError(`"${field}" is required`);
  if (opts?.max !== undefined && trimmed.length > opts.max) {
    throw new HttpError(`"${field}" must be at most ${opts.max} characters`);
  }
  return trimmed;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function handle(err: unknown): NextResponse {
  if (err instanceof HttpError) return fail(err.message, err.status);
  if (err instanceof Error) {
    const status = /already exists|duplicate|UNIQUE constraint/i.test(err.message) ? 409 : 500;
    return fail(err.message || "Request failed", status);
  }
  return fail("Request failed", 500);
}

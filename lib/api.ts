import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError("Expected a JSON object");
    return body as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError("Invalid JSON body");
  }
}

export function str(value: unknown, field: string, opts: { optional?: boolean; max?: number } = {}): string {
  if (value === undefined || value === null || value === "") {
    if (opts.optional) return "";
    throw new HttpError(`${field} is required`);
  }
  if (typeof value !== "string" && typeof value !== "number") throw new HttpError(`${field} must be text`);
  const s = String(value).trim();
  if (!opts.optional && !s) throw new HttpError(`${field} is required`);
  if (opts.max && s.length > opts.max) throw new HttpError(`${field} is too long`);
  return s;
}

export function num(value: unknown, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number {
  if (value === undefined || value === null || value === "") {
    if (opts.optional) return 0;
    throw new HttpError(`${field} is required`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(`${field} must be a number`);
  if (opts.min !== undefined && n < opts.min) throw new HttpError(`${field} must be at least ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new HttpError(`${field} must be at most ${opts.max}`);
  return n;
}

export function date(value: unknown, field: string, opts: { optional?: boolean } = {}): string {
  if (value === undefined || value === null || value === "") {
    if (opts.optional) return "";
    throw new HttpError(`${field} is required`);
  }
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00`).getTime())) {
    throw new HttpError(`${field} must be a valid date`);
  }
  return s;
}

export function pick<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const s = String(value ?? "");
  if (!allowed.includes(s as T)) throw new HttpError(`${field} must be one of: ${allowed.join(", ")}`);
  return s as T;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function handle(err: unknown) {
  if (err instanceof HttpError) return fail(err.message, err.status);
  console.error("[API]", err);
  return fail("Something went wrong on the server", 500);
}

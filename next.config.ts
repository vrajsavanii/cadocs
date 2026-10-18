import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Security headers applied to every response:
 * - nosniff prevents MIME sniffing of uploads/exports
 * - X-Frame-Options / COOP block clickjacking and window-opener attacks
 * - strict referrer keeps URLs (which can contain client ids) off cross sites
 * - CSP: scripts and styles from this origin only (dev adds eval/ws for HMR,
 *   production tightens connect-src to 'self'), images from self/data/blob
 *   (uploaded documents render inline), no framing, no origin drift.
 * - HSTS in production so a later HTTPS deployment is never downgraded.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
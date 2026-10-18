import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { getNavCounts, getSettings } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { Sidebar, Topbar, MobileNav } from "@/components/shell";
import { ToastProvider } from "@/components/interactive";
import { AiCommand } from "@/components/ai-command";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-jakarta",
  preload: true,
});

export const dynamic = "force-dynamic";

/** The workspace is branded with the client's own firm name; the product is CADocs. */
export async function generateMetadata(): Promise<Metadata> {
  const firm = getSettings().firm_name || "your firm";
  return {
    title: `${firm} — CADocs`,
    description:
      "CADocs by NexAgent — AI-powered practice management for Indian CA firms: compliance calendar, client desk, fee recovery, documents, UDIN, DSC, notices and timesheets.",
  };
}

export const viewport: Viewport = {
  themeColor: "#EBE9E4",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  // proxy.ts forwards the pathname; the public site never wears the shell,
  // even when a signed-in partner previews it.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const publicSurface = pathname === "/site" || pathname.startsWith("/site/");

  // Signed out (or on the marketing pages): no practice shell. The proxy gates
  // every app route to /login; these surfaces render on their own.
  if (!user || publicSurface) {
    return (
      <html lang="en" className={jakarta.variable}>
        <body className="min-h-dvh bg-canvas antialiased">
          <ToastProvider>{children}</ToastProvider>
        </body>
      </html>
    );
  }

  const settings = getSettings();
  const counts = getNavCounts();

  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        <ToastProvider>
          <Sidebar counts={counts} firmName={settings.firm_name ?? "Sharma & Associates"} />
          <div className="lg:pl-[var(--sidebar-w,100px)]">
            <Topbar
              firmName={settings.firm_name ?? "Sharma & Associates"}
              city={settings.firm_city ?? "Mumbai"}
              user={{ name: user.name, role: user.role }}
            />
            <MobileNav />
            <main className="mx-auto max-w-[1500px] px-4 pb-20 pt-5 md:px-8">{children}</main>
          </div>
          <AiCommand />
        </ToastProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { COMPANY_NAME, HERO, PRODUCT_NAME } from "@/lib/site-content";

/**
 * Public marketing layout.
 *
 * The root layout drops the practice shell for `/site*` (it sees the pathname
 * through the `x-pathname` request header set by `proxy.ts`), so this page
 * renders standalone whether the visitor is signed out — the usual case — or a
 * member of the firm previewing the site while signed in.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  // Our own product site — never the demo firm's name from Settings.
  return {
    title: `${PRODUCT_NAME} — practice management for Indian CA firms`,
    description: `${HERO.title}. ${HERO.sub}`,
    keywords: [
      "CA practice management software",
      "GST compliance calendar",
      "CA firm software India",
      "UDIN register",
      "client document collection",
      "fee recovery for CA firms",
    ],
    openGraph: {
      title: `${PRODUCT_NAME} — run the whole practice from one desk`,
      description: HERO.sub,
      type: "website",
      siteName: `${PRODUCT_NAME} by ${COMPANY_NAME}`,
    },
    twitter: { card: "summary_large_image", title: PRODUCT_NAME, description: HERO.sub },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  themeColor: "#EBE9E4",
  width: "device-width",
  initialScale: 1,
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// The landing page is public. The app routes run entirely in the visitor's
// browser and hold no server-side data; they are simply not the page we
// want in search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/api/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/track";

/** Records one landing-page view (no URL, referrer or user data). */
export function TrackLandingView() {
  useEffect(() => {
    track({ name: "landing_view" });
  }, []);
  return null;
}

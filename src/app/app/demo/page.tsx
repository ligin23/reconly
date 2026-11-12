import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Reconly demo — fictional sample data",
};

/** Opens the app and starts the existing Advanced Demo (fictional data). */
export default function DemoPage() {
  return <AppShell autoStart="advanced-demo" />;
}

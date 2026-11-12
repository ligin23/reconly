import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Social-sharing card: the headline next to a real screenshot of Reconly's
// Results screen (fictional Advanced Demo data). Generated at build time.
export const alt = "Reconly — the Results screen of the fictional Advanced Demo, with the headline “Bank reconciliation, without the accounting headache.”";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const shot = await readFile(join(process.cwd(), "public/landing/results-overview.png"), "base64");
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f7f7f5", fontFamily: "sans-serif" }}>
        <div style={{ width: 470, padding: "64px 0 64px 64px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 36 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: "#1f4e9a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4 10-11" />
              </svg>
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, color: "#1d2433" }}>Reconly</div>
          </div>
          <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.12, color: "#16213a", letterSpacing: -1 }}>
            Bank reconciliation, without the accounting headache.
          </div>
          <div style={{ fontSize: 22, marginTop: 24, color: "#566070" }}>Try the free demo — no account needed.</div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", paddingLeft: 40 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${shot}`}
            width={1100}
            height={657}
            style={{ borderRadius: 18, border: "1px solid #e3e3df", boxShadow: "0 20px 50px rgba(30,40,70,0.18)" }}
            alt=""
          />
        </div>
      </div>
    ),
    size
  );
}

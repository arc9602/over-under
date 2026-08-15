"use client"; // Error boundaries must be Client Components

/**
 * Catches errors thrown by the root layout itself (app/layout.tsx). Because
 * this replaces the root layout when it fires, it must render its own
 * <html> and <body> -- there is no longer any layout above it to provide
 * them -- and it cannot assume app/globals.css loaded, since the failure may
 * be in the very tree that would have loaded it. So, deliberately and only
 * here (per plans/006-polish-pass.md A3), styling is inline rather than
 * Tailwind tokens. The colors below are the literal values of this app's
 * dark-theme tokens (app/globals.css `.dark`), copied rather than
 * referenced, so this screen still reads as Over/Under even if the
 * stylesheet that defines those tokens is exactly what failed to load.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          backgroundColor: "oklch(0.09 0 0)", // --background
          color: "oklch(0.97 0 0)", // --foreground
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ width: "100%", maxWidth: 384, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          {/* Fixed copy, never derived from `error` -- same guarantee as
              app/error.tsx: error.message is never rendered here. */}
          <p
            style={{
              fontSize: "0.875rem",
              color: "oklch(0.62 0 0)", // --muted-foreground
              margin: "0 0 20px",
            }}
          >
            Over/Under hit a problem it couldn&apos;t recover from. Reloading
            usually fixes it.
          </p>
          <button
            onClick={() => reset()}
            style={{
              width: "100%",
              padding: "10px 16px",
              marginBottom: 8,
              borderRadius: 8,
              border: "none",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
              backgroundColor: "oklch(0.84 0.22 128.36)", // --primary
              color: "oklch(0.14 0 0)", // --primary-foreground
            }}
          >
            Try again
          </button>
          {/* A plain anchor, not next/link: the root layout that would carry
              router context is the thing that just failed to render. */}
          <a
            href="/"
            style={{
              display: "block",
              width: "100%",
              padding: "10px 16px",
              boxSizing: "border-box",
              borderRadius: 8,
              border: "1px solid oklch(1 0 0 / 10%)", // --border
              fontSize: "0.875rem",
              fontWeight: 600,
              textDecoration: "none",
              color: "oklch(0.97 0 0)", // --foreground
            }}
          >
            Go to Over/Under
          </a>
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "oklch(0.62 0 0 / 60%)",
                marginTop: 16,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}

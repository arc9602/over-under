import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Over/Under",
  description: "Private prediction markets with friends",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        {/* Offset above the mobile bottom nav so toasts never cover it. */}
        <Toaster
          position="top-center"
          offset={16}
          mobileOffset={{ bottom: 80, top: 16, left: 16, right: 16 }}
          toastOptions={{
            classNames: {
              toast:
                "!bg-popover !text-popover-foreground !border-border !rounded-lg !shadow-lg",
              description: "!text-muted-foreground",
              actionButton: "!bg-primary !text-primary-foreground",
              cancelButton: "!bg-secondary !text-secondary-foreground",
              error: "!text-destructive",
              success: "!text-emerald-400",
            },
          }}
        />
      </body>
    </html>
  );
}

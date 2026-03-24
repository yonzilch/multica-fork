import type { Metadata } from "next";
import { ThemeProvider } from "@multica/ui/components/theme-provider";
import { Toaster } from "@multica/ui/components/ui/sonner";
import { AuthInitializer } from "@/features/auth";
import { WSProvider } from "@/features/realtime";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multica",
  description: "AI-native task management",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthInitializer>
            <WSProvider>{children}</WSProvider>
          </AuthInitializer>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

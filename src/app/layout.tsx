import type { Metadata } from "next";
import Script from "next/script";
import type { Viewport } from "next";
import { PwaClient } from "@/components/PwaClient";
import "../styles/globals.scss";

export const metadata: Metadata = {
  title: "WorkFlow Journal",
  description: "A visual journal for the workday.",
  applicationName: "WorkFlow Journal",
  appleWebApp: {
    capable: true,
    title: "WorkFlow Journal",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#7d41db",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const themeBootstrap = `
  (function () {
    try {
      var theme = localStorage.getItem("workflow.theme");
      var validTheme = theme === "dark" || theme === "light" ? theme : "light";
      document.documentElement.dataset.theme = validTheme;
      document.documentElement.style.colorScheme = validTheme;
    } catch (error) {
      document.documentElement.dataset.theme = "light";
      document.documentElement.style.colorScheme = "light";
    }
  })();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body>
        <Script id="workflow-theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
        <PwaClient />
        {children}
        <div id="overlay-root" />
      </body>
    </html>
  );
}

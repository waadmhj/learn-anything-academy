import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { CourseProvider } from "@/lib/course";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-mono-jb", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Learn Anything Academy", template: "%s · Learn Anything Academy" },
  description: "Turn any subject or syllabus into a structured course with the best-rated material.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#111113" },
  ],
};

// Applies the saved theme before paint to avoid a flash of the wrong theme.
const themeScript = `try{var t=localStorage.getItem('academy.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} ${mono.variable} font-sans antialiased`}>
        <CourseProvider>
          <AppShell>{children}</AppShell>
        </CourseProvider>
      </body>
    </html>
  );
}

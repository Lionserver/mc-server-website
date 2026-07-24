import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "운영자 센터",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export default function OperatorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}

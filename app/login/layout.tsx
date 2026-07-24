import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "운영자 로그인",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export default function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}

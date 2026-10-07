import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "기도 나눔 | 구리교회 청년회",
  description: "서로의 기도를 기억하고 마음을 모으는 구리교회 청년회 기도 나눔 공간입니다.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body><a className="skip-link" href="#main">본문으로 바로가기</a>{children}</body></html>;
}

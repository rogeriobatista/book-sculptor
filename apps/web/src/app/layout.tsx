import type { ReactNode } from "react";
import "./globals.css";

type Props = {
  children: ReactNode;
};

/** Root shell — locale-specific html/body live under [locale]. */
export default function RootLayout({ children }: Props) {
  return children;
}

import type { ReactNode } from "react";
import { RequireSignIn } from "@/components/RequireSignIn";

type Props = {
  children: ReactNode;
};

export default function BooksLayout({ children }: Props) {
  return <RequireSignIn>{children}</RequireSignIn>;
}

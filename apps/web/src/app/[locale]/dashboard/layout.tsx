import type { ReactNode } from "react";
import { RequireSignIn } from "@/components/RequireSignIn";

type Props = {
  children: ReactNode;
};

export default function DashboardLayout({ children }: Props) {
  return <RequireSignIn>{children}</RequireSignIn>;
}

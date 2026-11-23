import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function ResetPasswordPage() {
  return <main className="flex flex-1 items-center justify-center p-6"><ResetPasswordForm /></main>;
}

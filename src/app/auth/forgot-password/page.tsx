import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const { branding, links } = await getPublicConfig();

  return (
    <main>
      <BrandMark branding={branding} />
      <h1>Reset your password</h1>
      <p>Enter your email address and we will send a password reset link.</p>
      <ForgotPasswordForm />
      <p>
        Remembered it? <Link href="/auth/sign-in">Sign in</Link>
      </p>
      <p>
        <Link href={links.privacyUrl}>Privacy</Link> ·{" "}
        <Link href={links.termsUrl}>Terms</Link> ·{" "}
        <Link href={links.supportUrl}>Support</Link>
      </p>
    </main>
  );
}

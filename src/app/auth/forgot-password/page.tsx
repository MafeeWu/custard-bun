import Link from "next/link";
import {
  AuthBrandPanel,
  AuthFormLayout,
} from "@/components/auth/auth-form-layout";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { AuthShell } from "@/components/layout/auth-shell";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const { branding, links } = await getPublicConfig();

  return (
    <AuthShell
      aside={<AuthBrandPanel branding={branding} />}
      brand={<BrandMark branding={branding} />}
    >
      <AuthFormLayout
        alternateAction={
          <p>
            Remembered it? <Link href="/auth/sign-in">Sign in</Link>
          </p>
        }
        description="Enter your email address and we will send a password reset link."
        legalLinks={links}
        title="Reset your password"
      >
        <ForgotPasswordForm />
      </AuthFormLayout>
    </AuthShell>
  );
}

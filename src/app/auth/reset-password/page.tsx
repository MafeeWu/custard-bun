import Link from "next/link";
import {
  AuthBrandPanel,
  AuthFormLayout,
} from "@/components/auth/auth-form-layout";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { AuthShell } from "@/components/layout/auth-shell";
import { StatusNotice } from "@/components/ui/status-notice";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

interface ResetPasswordPageProps {
  searchParams: Promise<{
    token?: string | string[];
  }>;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const { branding, links } = await getPublicConfig();
  const resolvedSearchParams = await searchParams;
  const token = Array.isArray(resolvedSearchParams.token)
    ? resolvedSearchParams.token[0]
    : resolvedSearchParams.token;

  return (
    <AuthShell
      aside={<AuthBrandPanel branding={branding} />}
      brand={<BrandMark branding={branding} />}
    >
      <AuthFormLayout
        description={token ? "Enter a new password for your account." : ""}
        legalLinks={links}
        title="Choose a new password"
      >
        {!token ? (
          <div className="auth-form-layout__stack">
            <StatusNotice tone="danger">
              This reset link is invalid or has expired.
            </StatusNotice>
            <p className="auth-form-layout__support-copy">
              Request a new link from the{" "}
              <Link href="/auth/forgot-password">forgot password page</Link>.
            </p>
          </div>
        ) : (
          <ResetPasswordForm />
        )}
      </AuthFormLayout>
    </AuthShell>
  );
}

import Link from "next/link";
import {
  AuthBrandPanel,
  AuthFormLayout,
} from "@/components/auth/auth-form-layout";
import { BrandMark } from "@/components/brand/brand-mark";
import { AuthShell } from "@/components/layout/auth-shell";
import { StatusNotice } from "@/components/ui/status-notice";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { branding, links } = await getPublicConfig();
  const failed = Boolean((await searchParams).error);

  return (
    <AuthShell
      aside={<AuthBrandPanel branding={branding} />}
      brand={<BrandMark branding={branding} />}
    >
      <AuthFormLayout
        alternateAction={
          <p>
            After verification, continue to{" "}
            <Link href="/auth/sign-in">Sign in</Link>.
          </p>
        }
        description=""
        legalLinks={links}
        title={failed ? "Email verification" : "Check your email"}
      >
        <StatusNotice tone={failed ? "danger" : "info"}>
          {failed
            ? "This verification link is invalid or has expired. Sign in again to request a new link."
            : "Open the verification link we sent you, then return here and sign in."}
        </StatusNotice>
      </AuthFormLayout>
    </AuthShell>
  );
}

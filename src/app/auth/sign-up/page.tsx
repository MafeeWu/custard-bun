import Link from "next/link";
import {
  AuthBrandPanel,
  AuthFormLayout,
} from "@/components/auth/auth-form-layout";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { AuthShell } from "@/components/layout/auth-shell";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const { branding, links, registration } = await getPublicConfig();

  return (
    <AuthShell
      aside={<AuthBrandPanel branding={branding} />}
      brand={<BrandMark branding={branding} />}
    >
      <AuthFormLayout
        alternateAction={
          <p>
            Already have an account? <Link href="/auth/sign-in">Sign in</Link>
          </p>
        }
        description="Start private conversations with persistent official characters."
        legalLinks={links}
        title={`Create your ${branding.name} account`}
      >
        <SignUpForm registrationOpen={registration.open} />
      </AuthFormLayout>
    </AuthShell>
  );
}

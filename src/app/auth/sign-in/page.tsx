import Link from "next/link";
import {
  AuthBrandPanel,
  AuthFormLayout,
} from "@/components/auth/auth-form-layout";
import { SignInForm } from "@/components/auth/sign-in-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { AuthShell } from "@/components/layout/auth-shell";
import { LinkButton } from "@/components/ui/button";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const { branding, links, registration } = await getPublicConfig();

  return (
    <AuthShell
      aside={<AuthBrandPanel branding={branding} />}
      brand={<BrandMark branding={branding} />}
    >
      <AuthFormLayout
        alternateAction={
          <>
            <LinkButton href="/auth/forgot-password" size="md" tone="quiet">
              Forgot your password?
            </LinkButton>
            {registration.open ? (
              <p>
                Need an account?{" "}
                <Link href="/auth/sign-up">Create account</Link>
              </p>
            ) : null}
          </>
        }
        description="Continue your ongoing conversations with your characters."
        legalLinks={links}
        title={`Sign in to ${branding.name}`}
      >
        <SignInForm />
      </AuthFormLayout>
    </AuthShell>
  );
}

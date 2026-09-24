import Link from "next/link";
import { SignInForm } from "@/components/auth/sign-in-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const { branding, links, registration } = await getPublicConfig();

  return (
    <main>
      <BrandMark branding={branding} />
      <h1>Sign in to {branding.name}</h1>
      <p>Continue your ongoing conversations with your characters.</p>
      <SignInForm />
      <p>
        <Link href="/auth/forgot-password">Forgot your password?</Link>
      </p>
      {registration.open ? (
        <p>
          Need an account? <Link href="/auth/sign-up">Create account</Link>
        </p>
      ) : null}
      <p>
        <Link href={links.privacyUrl}>Privacy</Link> ·{" "}
        <Link href={links.termsUrl}>Terms</Link> ·{" "}
        <Link href={links.supportUrl}>Support</Link>
      </p>
    </main>
  );
}

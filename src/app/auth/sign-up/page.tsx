import Link from "next/link";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const { branding, links, registration } = await getPublicConfig();

  return (
    <main>
      <BrandMark branding={branding} />
      <h1>Create your {branding.name} account</h1>
      <p>Start private conversations with persistent official characters.</p>
      <SignUpForm registrationOpen={registration.open} />
      <p>
        Already have an account? <Link href="/auth/sign-in">Sign in</Link>
      </p>
      <p>
        <Link href={links.privacyUrl}>Privacy</Link> ·{" "}
        <Link href={links.termsUrl}>Terms</Link> ·{" "}
        <Link href={links.supportUrl}>Support</Link>
      </p>
    </main>
  );
}

import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage() {
  const { branding, links } = await getPublicConfig();

  return (
    <main>
      <BrandMark branding={branding} />
      <h1>Check your email</h1>
      <p>
        Open the verification link we sent you, then return here and sign in.
      </p>
      <p>
        After verification, continue to <Link href="/auth/sign-in">Sign in</Link>.
      </p>
      <p>
        <Link href={links.privacyUrl}>Privacy</Link> ·{" "}
        <Link href={links.termsUrl}>Terms</Link> ·{" "}
        <Link href={links.supportUrl}>Support</Link>
      </p>
    </main>
  );
}

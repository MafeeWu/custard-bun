import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
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
    <main>
      <BrandMark branding={branding} />
      <h1>{failed ? "Email verification" : "Check your email"}</h1>
      {failed ? (
        <p role="alert">
          This verification link is invalid or has expired. Sign in again to
          request a new link.
        </p>
      ) : (
        <p>
          Open the verification link we sent you, then return here and sign in.
        </p>
      )}
      <p>
        After verification, continue to{" "}
        <Link href="/auth/sign-in">Sign in</Link>.
      </p>
      <p>
        <Link href={links.privacyUrl}>Privacy</Link> ·{" "}
        <Link href={links.termsUrl}>Terms</Link> ·{" "}
        <Link href={links.supportUrl}>Support</Link>
      </p>
    </main>
  );
}

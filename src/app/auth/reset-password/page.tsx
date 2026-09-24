import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { BrandMark } from "@/components/brand/brand-mark";
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
    <main>
      <BrandMark branding={branding} />
      <h1>Choose a new password</h1>
      {!token ? (
        <>
          <p role="alert">This reset link is invalid or has expired.</p>
          <p>
            Request a new link from the{" "}
            <Link href="/auth/forgot-password">forgot password page</Link>.
          </p>
        </>
      ) : (
        <>
          <p>Enter a new password for your account.</p>
          <ResetPasswordForm />
        </>
      )}
      <p>
        <Link href={links.privacyUrl}>Privacy</Link> ·{" "}
        <Link href={links.termsUrl}>Terms</Link> ·{" "}
        <Link href={links.supportUrl}>Support</Link>
      </p>
    </main>
  );
}

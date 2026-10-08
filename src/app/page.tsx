import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

const config = await getPublicConfig();

export default function HomePage() {
  return (
    <main className="page-shell">
      <BrandMark branding={config.branding} />
      <h1>{config.branding.name}</h1>
      <p>{config.branding.description}</p>
      <div className="page-actions">
        <Link
          className="brand-primary"
          href={config.registration.open ? "/auth/sign-up" : "/auth/sign-in"}
        >
          Get started
        </Link>
        <Link className="brand-link" href="/characters">
          Browse characters
        </Link>
      </div>
    </main>
  );
}

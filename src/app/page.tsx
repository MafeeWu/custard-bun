import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

const config = await getPublicConfig();

export default function HomePage() {
  return (
    <main>
      <BrandMark branding={config.branding} />
      <h1>{config.branding.name}</h1>
      <p>{config.branding.description}</p>
      <Link
        className="brand-primary"
        href={config.registration.open ? "/auth/sign-up" : "/auth/sign-in"}
      >
        Get started
      </Link>
    </main>
  );
}

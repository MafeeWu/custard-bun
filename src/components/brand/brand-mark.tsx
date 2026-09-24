import Image from "next/image";
import type { PublicAppConfig } from "@/server/config/schema";

export function BrandMark({
  branding,
}: {
  branding: PublicAppConfig["branding"];
}) {
  return (
    <span className="inline-flex items-center gap-3">
      <Image src={branding.logoPath} alt="" width={40} height={40} priority />
      <span>{branding.name}</span>
    </span>
  );
}

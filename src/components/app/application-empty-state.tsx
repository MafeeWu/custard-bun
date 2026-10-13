import { BrandMark } from "@/components/brand/brand-mark";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { PublicAppConfig } from "@/server/config/schema";

export function ApplicationEmptyState({
  branding,
}: {
  branding: PublicAppConfig["branding"];
}) {
  return (
    <EmptyState
      action={<LinkButton href="/characters">Browse characters</LinkButton>}
      artwork={
        <div className="application-empty-state__brand">
          <BrandMark branding={branding} />
        </div>
      }
      className="application-empty-state"
      description={`Browse the official ${branding.name} character catalog whenever you're ready to begin a new thread.`}
      title="No active conversations yet"
    />
  );
}

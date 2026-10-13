import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";

export default function GoodbyePage() {
  return (
    <main className="page-shell page-stack goodbye-page">
      <Surface
        as="section"
        className="goodbye-page__surface"
        padding="lg"
        tone="raised"
      >
        <PageHeader
          description="If your deletion confirmation was valid, account access has stopped and private-data removal is queued. Purging may still be in progress."
          title="You are signed out"
        />
        <div className="page-actions">
          <LinkButton href="/" tone="secondary">
            Return home
          </LinkButton>
        </div>
      </Surface>
    </main>
  );
}

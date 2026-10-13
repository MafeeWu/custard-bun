import { headers } from "next/headers";
import Link from "next/link";
import { AccountSection } from "@/components/account/account-section";
import { DeleteAccountForm } from "@/components/account/delete-account-form";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession } from "@/server/auth/require-session";
import { getPublicConfig } from "@/server/config/public-config";
import { getDatabase } from "@/server/db/database";
import { listMemoryRelationships } from "@/server/memory/memory-queries";
import { MemoryRelationshipOverview } from "@/components/memory/memory-relationship-overview";
import { DataExportPanel } from "@/components/account/data-export-panel";
import { listDataExportsForUser } from "@/server/privacy/data-export-service";

export default async function AccountPage() {
  const requestHeaders = await headers();
  const [session, config, database] = await Promise.all([
    requireSession(requestHeaders),
    getPublicConfig(),
    getDatabase(),
  ]);
  const relationships = await listMemoryRelationships(
    database,
    session.user.id,
  );
  const exports = await listDataExportsForUser(database, {
    userId: session.user.id,
    now: new Date(),
  });

  return (
    <main className="page-shell page-stack account-page">
      <PageHeader
        className="account-page__header"
        description="Review profile details, privacy controls, export history, and support links for this account."
        title="Account"
      />

      <div className="account-page__grid">
        <div className="account-page__primary">
          <AccountSection
            actions={
              <LinkButton href="/auth/forgot-password" tone="secondary">
                Reset password
              </LinkButton>
            }
            description="Verify the identity details attached to this session and keep account access current."
            headingId="account-profile-heading"
            title="Profile and session"
          >
            <dl className="account-profile-list">
              <div className="account-profile-list__row">
                <dt>Name</dt>
                <dd>{session.user.name}</dd>
              </div>
              <div className="account-profile-list__row">
                <dt>Email</dt>
                <dd>{session.user.email}</dd>
              </div>
              <div className="account-profile-list__row">
                <dt>Email status</dt>
                <dd>
                  {session.user.emailVerified ? "Verified" : "Unverified"}
                </dd>
              </div>
            </dl>
          </AccountSection>

          <AccountSection
            description="Control recording and chat usage, edit memories, or ask a character to forget you."
            headingId="account-privacy-heading"
            title="Privacy"
          >
            <div className="account-privacy">
              <Link href="/app/memories" className="brand-link">
                Manage all character memories
              </Link>
              <MemoryRelationshipOverview relationships={relationships} />
            </div>
          </AccountSection>
        </div>

        <div className="account-page__secondary">
          <DataExportPanel exports={exports} />
          <DeleteAccountForm email={session.user.email} />
          <AccountSection
            description="Review the published policies and contact links that apply to this installation."
            headingId="account-legal-heading"
            title="Legal and support"
          >
            <ul className="account-link-list">
              <li>
                <Link className="brand-link" href={config.links.privacyUrl}>
                  Privacy
                </Link>
              </li>
              <li>
                <Link className="brand-link" href={config.links.termsUrl}>
                  Terms
                </Link>
              </li>
              <li>
                <Link className="brand-link" href={config.links.supportUrl}>
                  Support
                </Link>
              </li>
            </ul>
          </AccountSection>
        </div>
      </div>
    </main>
  );
}

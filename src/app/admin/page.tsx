import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminSection } from "@/components/admin/admin-section";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <section className="admin-page">
      <AdminPageHeader
        title="Administration"
        description="Review characters, user access, and audit history from this protected console."
      />
      <AdminSection
        title="Protected operations"
        description="Use these aggregate and configuration views without opening private conversation or memory content."
      >
        <p className="admin-helper-text">
          Choose an area from the administration navigation.
        </p>
      </AdminSection>
    </section>
  );
}

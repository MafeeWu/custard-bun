import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { AdminDataList } from "./admin-data-list";
import { AdminPageHeader } from "./admin-page-header";
import { AdminSection } from "./admin-section";

test("admin page foundations render compact headers and sections", () => {
  render(
    <AdminSection
      title="Operational controls"
      description="Change only aggregate settings."
      actions={<a href="/admin/audit">Audit</a>}
    >
      <p>Controls stay dense.</p>
    </AdminSection>,
  );

  expect(
    screen.getByRole("region", { name: "Operational controls" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
    "Operational controls",
  );
  expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute(
    "href",
    "/admin/audit",
  );

  render(
    <AdminPageHeader
      title="Administration"
      description="Protected operations."
      actions={<a href="/admin/users">Users</a>}
    />,
  );

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Administration",
  );
  expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute(
    "href",
    "/admin/users",
  );
});

test("admin data list renders table columns and mobile definition labels", () => {
  render(
    <AdminDataList
      ariaLabel="Official characters"
      columns={[
        {
          key: "name",
          header: "Name",
          priority: "primary",
          cell: (row) => row.name,
        },
        {
          key: "status",
          header: "Status",
          priority: "secondary",
          cell: (row) => (
            <span className="admin-status-pill">{row.status}</span>
          ),
        },
        {
          key: "detail",
          header: "Revision detail",
          priority: "detail",
          cell: (row) => row.detail,
        },
      ]}
      emptyTitle="No characters"
      getRowKey={(row) => row.id}
      rows={[
        {
          id: "row-1",
          name: "A very long character name that should wrap instead of clipping",
          status: "active",
          detail: "Draft r3 · base v2 · default v1 · latest v2",
        },
      ]}
    />,
  );

  const table = screen.getByRole("table", { name: "Official characters" });
  expect(
    within(table).getByRole("columnheader", { name: "Name" }),
  ).toBeVisible();
  expect(
    within(table).getByText(
      "A very long character name that should wrap instead of clipping",
    ),
  ).toBeVisible();

  const mobileCards = screen.getByRole("list", {
    name: "Official characters mobile cards",
  });
  expect(within(mobileCards).getByText("Name")).toBeVisible();
  expect(within(mobileCards).getByText("Status")).toBeVisible();
  expect(within(mobileCards).getByText("active")).toBeVisible();
});

test("admin data list renders an empty state without table scaffolding", () => {
  render(
    <AdminDataList
      ariaLabel="Provider failures"
      columns={[
        {
          key: "category",
          header: "Category",
          priority: "primary",
          cell: (row) => row.category,
        },
      ]}
      emptyDescription="Nothing has failed."
      emptyTitle="No provider failures"
      getRowKey={(row) => row.category}
      rows={[] as Array<{ category: string }>}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "No provider failures" }),
  ).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

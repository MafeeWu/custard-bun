import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
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

test("admin data list renders a single table with responsive cell labels", () => {
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

  expect(within(table).getByText("active").closest("td")).toHaveAttribute(
    "data-label",
    "Status",
  );
  expect(screen.getAllByText("active")).toHaveLength(1);
});

test("responsive cells create one stateful form, preserving draft and pending feedback on rerender", () => {
  function EditCell() {
    const [draft, setDraft] = useState("12");
    const [pending, setPending] = useState(false);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
        }}
      >
        <label>
          Quota
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button disabled={pending}>{pending ? "Saving" : "Save"}</button>
        {pending && <p role="status">Saving quota {draft}</p>}
      </form>
    );
  }
  const list = () => (
    <AdminDataList
      ariaLabel="Quotas"
      rows={[{ id: "one" }]}
      getRowKey={(row) => row.id}
      columns={[
        {
          key: "edit",
          header: "Quota",
          priority: "primary",
          cell: () => <EditCell />,
        },
      ]}
    />
  );
  const { rerender } = render(list());
  expect(screen.getAllByRole("textbox", { name: "Quota" })).toHaveLength(1);
  const input = screen.getByRole("textbox", { name: "Quota" });
  fireEvent.change(input, { target: { value: "37" } });
  fireEvent.submit(input.closest("form")!);
  rerender(list());
  expect(screen.getByRole("textbox", { name: "Quota" })).toBe(input);
  expect(input).toHaveValue("37");
  expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Saving quota 37");
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

import { type ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { cx } from "@/components/ui/cx";

export interface AdminDataColumn<Row> {
  key: string;
  header: string;
  cell(row: Row): ReactNode;
  priority: "primary" | "secondary" | "detail";
}

export function AdminDataList<Row>({
  ariaLabel,
  className,
  columns,
  emptyDescription,
  emptyTitle = "No records found",
  getRowKey,
  rows,
}: {
  ariaLabel: string;
  columns: Array<AdminDataColumn<Row>>;
  rows: Row[];
  getRowKey(row: Row): string;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        className={cx("admin-empty-state", className)}
        description={emptyDescription}
        title={emptyTitle}
      />
    );
  }

  const mobileColumns = [...columns].sort((left, right) => {
    const weights = { primary: 0, secondary: 1, detail: 2 };
    return weights[left.priority] - weights[right.priority];
  });

  return (
    <div className={cx("admin-data-list", className)}>
      <div className="admin-data-list__table-wrap">
        <table aria-label={ariaLabel} className="admin-data-list__table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((column) => (
                  <td
                    data-label={column.header}
                    data-priority={column.priority}
                    key={column.key}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul
        aria-label={`${ariaLabel} mobile cards`}
        className="admin-data-list__cards"
      >
        {rows.map((row) => (
          <li className="admin-data-list__card" key={getRowKey(row)}>
            <dl className="admin-data-list__definition">
              {mobileColumns.map((column) => (
                <div
                  className="admin-data-list__definition-row"
                  data-priority={column.priority}
                  key={column.key}
                >
                  <dt>{column.header}</dt>
                  <dd>{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

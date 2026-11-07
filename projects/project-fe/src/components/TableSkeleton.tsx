import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";

interface TableSkeletonProps {
  columns: number;
  rows?: number;
  /** widths per column as Tailwind w-* strings, e.g. ["w-48", "w-24"]. Cycles if shorter than columns. */
  colWidths?: string[];
}

export function TableSkeleton({ columns, rows = 10, colWidths = [] }: TableSkeletonProps) {
  const widths = ["w-40", "w-28", "w-24", "w-20", "w-16", "w-12"];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-auto rounded-xl border border-border bg-card">
        <Table className="[&_th:not(:last-child)]:border-r [&_th:not(:last-child)]:border-border [&_td:not(:last-child)]:border-r [&_td:not(:last-child)]:border-border">
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="h-10 px-3 text-left align-middle">
                  <Skeleton className="h-3.5 w-20 rounded" />
                </th>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, row) => (
              <TableRow key={row} className="border-b border-border last:border-0">
                {Array.from({ length: columns }).map((_, col) => {
                  const w = colWidths[col] ?? widths[col % widths.length];
                  // First column: two lines (name + sub-label)
                  if (col === 0) {
                    return (
                      <TableCell key={col} className="py-3">
                        <div className="flex flex-col gap-1.5">
                          <Skeleton className={`h-3.5 ${w} rounded`} />
                          <Skeleton className="h-2.5 w-16 rounded opacity-60" />
                        </div>
                      </TableCell>
                    );
                  }
                  // Escalation-style columns (last 2): two lines stacked with mini bar
                  if (col >= columns - 2) {
                    return (
                      <TableCell key={col} className="py-3">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex justify-between">
                            <Skeleton className="h-3 w-8 rounded" />
                            <Skeleton className="h-3 w-8 rounded" />
                          </div>
                          <Skeleton className="h-1 w-full rounded-full" />
                        </div>
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={col} className="py-3">
                      <Skeleton className={`h-3.5 ${w} rounded`} />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {/* Pagination bar skeleton */}
      <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5">
        <Skeleton className="h-3.5 w-24 rounded" />
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-16 rounded-md" />
        </div>
      </div>
    </div>
  );
}

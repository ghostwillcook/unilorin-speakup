export type ComplaintStatus = "PENDING" | "IN_REVIEW" | "RESOLVED" | "REJECTED";

/**
 * One place deciding how each status looks, so the student view and every
 * admin table agree. Status is the sole categorical use of colour in this
 * system, so the hues live in globals.css as .badge-* rather than here — a
 * table cell can never drift from the badge beside it.
 */
const STYLES: Record<ComplaintStatus, { cls: string; label: string }> = {
  PENDING: { cls: "badge-pending", label: "Pending" },
  IN_REVIEW: { cls: "badge-review", label: "In review" },
  RESOLVED: { cls: "badge-resolved", label: "Resolved" },
  REJECTED: { cls: "badge-rejected", label: "Rejected" },
};

export const STATUSES: ComplaintStatus[] = [
  "PENDING",
  "IN_REVIEW",
  "RESOLVED",
  "REJECTED",
];

export default function StatusBadge({ status }: { status: ComplaintStatus }) {
  const s = STYLES[status] ?? STYLES.PENDING;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

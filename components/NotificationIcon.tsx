/** A bell, in the admin sidebar's icon vocabulary (1.15rem box, 1.6 stroke,
 *  round caps/joins) so a Notifications nav entry renders exactly like its
 *  siblings in AdminSidebar/AdminDock. Standalone rather than inside those
 *  files because the nav wiring — sidebar rail, dock sheet — is a separate
 *  concern from this page, and both should import one shape.
 */
export default function NotificationIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.15rem] w-[1.15rem] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8.5a6 6 0 0 1 12 0c0 6.5 2.75 8.25 2.75 8.25H3.25S6 15 6 8.5Z" />
      <path d="M10.25 20.5a1.95 1.95 0 0 0 3.5 0" />
    </svg>
  );
}

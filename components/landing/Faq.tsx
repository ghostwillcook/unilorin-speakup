import { useState } from "react";

/**
 * The landing FAQ, per the Wollo spec: single column, hairline separators,
 * bold questions, a chevron that rotates with the open state.
 *
 * A button + aria-expanded pair rather than <details>, because the grid-rows
 * animation (see .wl-faq-a) needs the open state as an attribute, and
 * <details> cannot animate its height cross-browser.
 */
export default function Faq({
  items,
}: {
  items: Array<{ q: string; a: string }>;
}) {
  // One open panel at a time: with several, the chevron rotation gives no
  // clue which answer belongs to which question once two are expanded.
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="border-t border-[var(--wl-rule)]">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div className="wl-faq-item" key={item.q}>
            <h3>
              <button
                type="button"
                className="wl-faq-q"
                aria-expanded={isOpen}
                aria-controls={`wl-faq-panel-${i}`}
                id={`wl-faq-button-${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                {item.q}
                <svg
                  className="wl-faq-chev"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </button>
            </h3>
            <div
              className="wl-faq-a"
              data-open={isOpen}
              id={`wl-faq-panel-${i}`}
              role="region"
              aria-labelledby={`wl-faq-button-${i}`}
            >
              <div className="wl-faq-a-inner">
                <p className="wl-faq-a-text">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

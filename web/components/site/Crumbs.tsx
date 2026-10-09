import clsx from "clsx";
import Link from "next/link";
import { Fragment } from "react";

export interface Crumb {
  label: string;
  href?: string;
}

/** Percorso di navigazione. L'ultima voce porta aria-current="page". */
export function Crumbs({ items, onPhoto }: { items: Crumb[]; onPhoto?: boolean }) {
  return (
    <nav className={clsx("crumbs", onPhoto && "crumbs--onphoto")} aria-label="Percorso">
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 ? <span>/</span> : null}
          {c.href ? (
            <Link href={c.href}>{c.label}</Link>
          ) : (
            <span aria-current="page">{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { librarySrc } from "@/lib/library-pages";

/* The library is a separate application: one static file in public/, with its
   own state, its own storage and its own sign-in. It is not going to become a
   set of React routes, and it does not need to: what it needed was to stop
   taking over the window.

   So it is framed. This route is a real page of this app, which means the rail
   stays on the left, the row highlights, and the address bar says /library/shows
   rather than a query string. The file itself sits in the content area with
   `chrome=off`, so it leaves its own sidebar out and there is one rail on
   screen rather than two.

   Same origin, so nothing here is a cross-site frame: the session, the storage
   and the clipboard all behave exactly as they would on their own page.

   Which tail opens which page is in src/lib/library-pages.ts, where the
   sidebar's test can read it too. */

export default function LibraryFrame() {
  const pathname = usePathname();
  const src = librarySrc(pathname.split("/")[2] ?? "");

  return (
    // The negative margins cancel the padding the shell puts around every page.
    // A framed application supplies its own margins; left inside the shell's,
    // it would sit in a box with two sets of white space around it.
    <div className="-mx-4 -mt-4 -mb-28 md:-m-8">
      <iframe
        key={src}
        src={src}
        title="Image Library"
        // Same-origin, so this is the default allowlist rather than a widening
        // of it: named because the copy buttons inside depend on it.
        allow="clipboard-write; clipboard-read"
        className="block w-full border-0 h-[calc(100dvh-3.5rem)] md:h-dvh"
      />
    </div>
  );
}

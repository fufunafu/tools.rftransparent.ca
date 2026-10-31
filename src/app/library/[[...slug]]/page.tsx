"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { libraryHash, librarySrc } from "@/lib/library-pages";

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
  const slug = pathname.split("/")[2] ?? "";
  const frame = useRef<HTMLIFrameElement>(null);
  /* The src it is born with, and only that. Feeding the current slug back into
     `src` on every render is what made moving between the library's pages load
     the whole file again.

     useRef's argument is read on the first render and ignored afterwards,
     which is exactly the behaviour wanted here. Written this way rather than
     as a null ref filled in during the render: a ref must not be written to
     while rendering, and `string | null` is not what an iframe's src accepts. */
  const born = useRef(librarySrc(slug));
  const loaded = useRef(false);
  const waiting = useRef<string | null>(null);

  /* Moving between the library's pages is a fragment, not a new document.

     It used to be `key={src}`: every move threw the iframe away and fetched two
     megabytes again, and since the file draws the photo library before it reads
     the address, you watched the photo library for a second or two on the way
     to the page you had asked for. None of that was visible from this
     component, which is why it lasted as long as it did.

     A fragment move keeps the page, its session and its scroll position, and
     the library already listens for it: hashchange runs its router.

     `replace` rather than assigning to `hash`, so the Back button still leaves
     the library instead of walking backwards through the pages inside it while
     the rail on the left goes on claiming you are somewhere else. */
  const show = useCallback((want: string) => {
    const win = frame.current?.contentWindow;
    if (!win || !loaded.current) {
      waiting.current = want;
      return;
    }
    try {
      const at = win.location;
      if ((at.hash || "") === want) return;
      at.replace(at.pathname + at.search + want);
    } catch {
      // Not ready to be spoken to yet. The load handler tries again.
      waiting.current = want;
    }
  }, []);

  useEffect(() => {
    show(libraryHash(slug));
  }, [slug, show]);

  const onLoad = useCallback(() => {
    loaded.current = true;
    const want = waiting.current;
    waiting.current = null;
    if (want !== null) show(want);
  }, [show]);

  return (
    // The negative margins cancel the padding the shell puts around every page.
    // A framed application supplies its own margins; left inside the shell's,
    // it would sit in a box with two sets of white space around it.
    <div className="-mx-4 -mt-4 -mb-28 md:-m-8">
      <iframe
        ref={frame}
        src={born.current}
        onLoad={onLoad}
        title="Image Library"
        // Same-origin, so this is the default allowlist rather than a widening
        // of it: named because the copy buttons inside depend on it.
        allow="clipboard-write; clipboard-read"
        className="block w-full border-0 h-[calc(100dvh-3.5rem)] md:h-dvh"
      />
    </div>
  );
}

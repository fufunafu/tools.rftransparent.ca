/* The pages of the image library, and how our URL for one maps to its own.

   The library is a separate application: one static file in public/, framed by
   src/app/library/[[...slug]]/page.tsx. It addresses its pages with a hash
   (`#/trade-shows`) because it is served as a single asset at "/" and a real
   path would 404 on reload. The values below are those hashes, and they are
   not always our word for the page: our /library/vault is its #/passwords.

   This lives in its own file so the sidebar and the frame cannot drift apart.
   They did: the rail offered six pages, the library had grown to sixteen, and
   two of the six opened the photo library because the slug had been renamed
   inside the file. nav-items.test.ts now fails if the sidebar links to a page
   this map does not know.

   The slugs come from the registerPage() calls inside public/library.html. If
   a page is renamed there, it is renamed here. */
export const LIBRARY_PAGES: Record<string, string> = {
  // ours          the library's own
  photos: "",
  videos: "videos",
  shows: "trade-shows",
  stores: "stores",
  ads: "ads-analytics",
  "ads-meta": "ads-meta",
  "ads-google": "ads-google",
  "ads-report": "ads-report",
  "paid-posts": "paid-posts",
  vault: "passwords",
  team: "team",
  "new-employee": "new-employee",
  assistant: "assistant",
  workspace: "workspace",
  updates: "update-requests",
};

/** The src for the frame. Photos is the default, so /library alone still
 *  lands somewhere sensible, and an unknown tail does too. */
export function librarySrc(slug: string): string {
  const page = LIBRARY_PAGES[slug] ?? "";
  // Query first, then the hash: the other way round makes the whole thing
  // part of the fragment and chrome=off is never read.
  return `/library.html?chrome=off${page ? `#/${page}` : ""}`;
}

"use client";

import { useEffect } from "react";

// Fires the browser print dialog shortly after the print page renders so
// the user gets the PDF / print prompt without an extra click.
export default function PrintTrigger() {
  useEffect(() => {
    const t = setTimeout(() => {
      window.print();
    }, 250);
    return () => clearTimeout(t);
  }, []);
  return null;
}

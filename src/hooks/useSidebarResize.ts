"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
const COLLAPSED_WIDTH = 64;

export function useSidebarResize(initialWidth = 240) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(initialWidth);
  const isResizing = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = e.clientX;
      if (newWidth < COLLAPSED_WIDTH + 20) {
        setCollapsed(true);
      } else {
        setCollapsed(false);
        setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth)));
      }
    };
    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);

  return {
    collapsed,
    width: collapsed ? COLLAPSED_WIDTH : width,
    sidebarRef,
    handleMouseDown,
    toggleCollapsed,
  };
}

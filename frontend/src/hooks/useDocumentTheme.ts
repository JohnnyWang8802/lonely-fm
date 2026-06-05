import { useEffect } from "react";

const LIGHT_BG = "#f7f3ea";
const DARK_BG = "#151713";

/**
 * Syncs the document (html) background with the active theme so overscroll /
 * rubber-band areas never flash the opposite theme's color behind the UI.
 * Resets to the previous value on unmount (e.g. when leaving the talk room).
 */
export const useDocumentTheme = (dark: boolean) => {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.backgroundColor;
    root.style.backgroundColor = dark ? DARK_BG : LIGHT_BG;
    return () => {
      root.style.backgroundColor = previous;
    };
  }, [dark]);
};

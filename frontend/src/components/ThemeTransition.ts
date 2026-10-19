export function transitionTheme(
  targetTheme: "light" | "dark",
  event?: React.MouseEvent | MouseEvent,
  onTransition?: () => void
): void {
  const root = document.documentElement;

  // Determine click coordinates
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;

  if (event && event.clientX !== undefined && event.clientY !== undefined) {
    x = event.clientX;
    y = event.clientY;
  }

  root.style.setProperty("--click-x", `${x}px`);
  root.style.setProperty("--click-y", `${y}px`);

  // Check for prefers-reduced-motion or missing document.startViewTransition
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasViewTransition = "startViewTransition" in document && typeof (document as Document).startViewTransition === "function";

  if (prefersReduced || !hasViewTransition) {
    root.setAttribute("data-theme", targetTheme);
    if (onTransition) onTransition();
    return;
  }

  (document as Document).startViewTransition(() => {
    root.setAttribute("data-theme", targetTheme);
    if (onTransition) onTransition();
  });
}

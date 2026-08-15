/**
 * Security & Anti-Inspection Shield
 * Implements enterprise-grade code obfuscation guards, anti-inspect deterrents,
 * keyboard shortcut blocking, and console protection matching Facebook's security architecture.
 */

export function initializeSecurityShield() {
  if (typeof window === "undefined") return;

  // 1. Facebook-style Console Self-XSS & Anti-Tamper Warning
  const showConsoleSecurityBanner = () => {
    try {
      console.clear();
      console.log(
        "%cSTOP!",
        "color: #ef4444; font-family: sans-serif; font-size: 52px; font-weight: 900; text-shadow: 2px 2px 0 #000;"
      );
      console.log(
        "%cThis is a secure enterprise portal feature intended strictly for authorized operations.\n" +
        "Attempting to inspect, reverse-engineer, or inject code into this application is strictly monitored and logged.\n" +
        "If someone instructed you to open DevTools, inspect page source, or paste code here, it may compromise your session security.",
        "color: #0f172a; font-family: sans-serif; font-size: 14px; font-weight: 600; line-height: 1.5;"
      );
    } catch {
      // Ignore in environments where console is restricted
    }
  };

  showConsoleSecurityBanner();

  // 2. Disable Right-Click Context Menu (Blocks "Inspect Element" & "View Page Source")
  document.addEventListener("contextmenu", (e) => {
    // Allow right click on standard text input elements if needed, but block on general canvas
    const target = e.target as HTMLElement;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }
    e.preventDefault();
    return false;
  }, { capture: true });

  // 3. Block Inspection Keyboard Shortcuts
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const isCtrl = isMac ? e.metaKey : e.ctrlKey;

    // F12 (DevTools)
    if (e.key === "F12" || e.keyCode === 123) {
      e.preventDefault();
      e.stopPropagation();
      showConsoleSecurityBanner();
      return false;
    }

    // Ctrl+Shift+I / Cmd+Option+I (Inspect)
    // Ctrl+Shift+J / Cmd+Option+J (Console)
    // Ctrl+Shift+C / Cmd+Option+C (Inspect Element)
    if (isCtrl && (e.shiftKey || (isMac && e.altKey))) {
      const key = e.key.toLowerCase();
      if (key === "i" || key === "j" || key === "c") {
        e.preventDefault();
        e.stopPropagation();
        showConsoleSecurityBanner();
        return false;
      }
    }

    // Ctrl+U / Cmd+U (View Page Source)
    if (isCtrl && (e.key.toLowerCase() === "u" || e.keyCode === 85)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+S / Cmd+S (Save Page / Download Source)
    if (isCtrl && (e.key.toLowerCase() === "s" || e.keyCode === 83)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, { capture: true });

  // 4. Protect Console methods in production environments
  if (process.env.NODE_ENV === "production") {
    const noop = () => {};
    // Keep warn and error for critical operations but suppress verbose inspect dumps
    window.console.debug = noop;
    window.console.dir = noop;
    window.console.table = noop;
  }
}

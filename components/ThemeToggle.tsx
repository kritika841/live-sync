"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

function getSystemPreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getStoredDark(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem("satmi-theme") || localStorage.getItem("theme");
    if (stored === "dark") return true;
    if (stored === "light") return false;
    return getSystemPreference();
  } catch {
    return getSystemPreference();
  }
}

function applyTheme(isDark: boolean) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
  root.dataset.theme = isDark ? "dark" : "light";
}

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // 1. Initial resolution: stored preference > device system mode
    const initialDark = getStoredDark();
    setIsDark(initialDark);
    applyTheme(initialDark);
    setMounted(true);

    // 2. Listen for device theme preference changes if user hasn't set an explicit preference
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem("satmi-theme") || localStorage.getItem("theme");
      if (!stored || stored === "system") {
        setIsDark(e.matches);
        applyTheme(e.matches);
      }
    };
    mediaQuery.addEventListener("change", handleMediaChange);

    // 3. Listen for storage changes across tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "satmi-theme" || e.key === "theme") {
        const nextDark = getStoredDark();
        setIsDark(nextDark);
        applyTheme(nextDark);
      }
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      mediaQuery.removeEventListener("change", handleMediaChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  function toggleTheme() {
    const nextDark = !isDark;
    setIsDark(nextDark);
    applyTheme(nextDark);
    try {
      localStorage.setItem("satmi-theme", nextDark ? "dark" : "light");
      localStorage.setItem("theme", nextDark ? "dark" : "light");
    } catch {
      // storage unavailable
    }
  }

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Toggle theme"
        className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:border-ring/50 hover:bg-muted hover:text-foreground"
      >
        <span className="size-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme (defaults to device mode)" : "Switch to dark theme (defaults to device mode)"}
      className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:border-ring/50 hover:bg-muted hover:text-foreground"
    >
      {isDark ? <Sun size={17} className="text-amber-400" /> : <Moon size={17} className="text-foreground" />}
    </button>
  );
}

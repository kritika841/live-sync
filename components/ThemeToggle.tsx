"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
      const hasDark = document.documentElement.classList.contains("dark");
      setIsDark(hasDark);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function toggleTheme() {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("satmi-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("satmi-theme", "light");
      localStorage.setItem("theme", "light");
    }
  }

  if (!mounted) {
    return (
      <button
        aria-label="Toggle theme"
        className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:border-ring/50 hover:bg-muted hover:text-foreground"
      >
        <span className="size-4" />
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:border-ring/50 hover:bg-muted hover:text-foreground"
    >
      {isDark ? <Sun size={17} className="text-amber-400" /> : <Moon size={17} className="text-foreground" />}
    </button>
  );
}

import * as React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "secondary", size = "md", ...props }, ref) => {
    const base =
      "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

    const variants = {
      primary:
        "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 dark:shadow-none",
      secondary:
        "border-border bg-card text-foreground shadow-sm hover:border-ring/50 hover:bg-muted dark:shadow-none",
      ghost:
        "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
      danger:
        "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
    };

    const sizes = {
      sm: "h-9 px-3 text-sm",
      md: "h-10 px-4 text-sm",
      icon: "size-10 p-0",
    };

    return (
      <button
        ref={ref}
        className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

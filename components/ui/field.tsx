/* eslint-disable react/prop-types */
import * as React from "react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (props: InputProps, ref) => {
    const { className = "", type = "text", ...rest } = props;
    return (
      <input
        type={type}
        className={`h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition duration-150 placeholder:text-muted-foreground hover:border-ring/50 focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted ${className}`}
        ref={ref}
        {...rest}
      />
    );
  }
);
Input.displayName = "Input";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (props: SelectProps, ref) => {
    const { className = "", children, ...rest } = props;
    return (
      <select
        className={`h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition duration-150 hover:border-ring/50 focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted ${className}`}
        ref={ref}
        {...rest}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";

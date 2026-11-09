import type { ButtonHTMLAttributes } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

export const Button = ({ variant = "primary", className, type = "button", ...rest }: ButtonProps) => (
  <button type={type} className={["clniq-btn", `clniq-btn--${variant}`, className].filter(Boolean).join(" ")} {...rest} />
);

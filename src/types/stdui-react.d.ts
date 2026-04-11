declare module "@stdui/react" {
  import type { ComponentType, ReactNode } from "react";

  export interface BadgeProps {
    children?: ReactNode;
    className?: string;
    variant?: "soft" | "solid" | "outline" | "ghost" | "link";
    color?: "primary" | "secondary" | "warning" | "danger" | "success" | "info";
  }

  export function Badge(props: BadgeProps): ReactNode;

  export interface ButtonProps {
    label: string;
    onClick?: () => void;
    variant?: "solid" | "outline" | "ghost" | "link";
    color?: "primary" | "secondary" | "warning" | "danger" | "success";
    icon?: ComponentType<{
      className?: string;
      "aria-hidden"?: boolean;
    }>;
    size?: "sm" | "md" | "lg";
    iconOnly?: boolean;
    disabled?: boolean;
    children?: ReactNode;
    className?: string;
  }

  export function Button(props: ButtonProps): ReactNode;
}

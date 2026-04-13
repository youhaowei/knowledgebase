declare module "@stdui/react" {
  import type { ComponentType, ReactElement, ReactNode } from "react";

  export interface BadgeProps {
    children?: ReactNode;
    className?: string;
    variant?: "soft" | "solid" | "outline" | "ghost" | "link";
    color?: "primary" | "secondary" | "warning" | "danger" | "success" | "info";
  }

  // Declare as a React component returning a real element (or null) rather
  // than the broader ReactNode — ReactNode permits undefined, arrays, and
  // strings, which can break consumers that expect a discrete element.
  export function Badge(props: BadgeProps): ReactElement | null;

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

import Button from "../button/Button";
import type { ComponentPropsWithoutRef } from "react";
import "./header-action.css";

type HeaderActionProps =
  | ({ as: "summary" } & ComponentPropsWithoutRef<"summary">)
  | ({ as?: "button" } & ComponentPropsWithoutRef<"button">);

export default function HeaderAction({ className = "", ...props }: HeaderActionProps) {
  const classes = `header-action ${className}`.trim();

  if (props.as === "summary") {
    const { as, ...summaryProps } = props;
    return <summary className={classes} {...summaryProps} />;
  }

  const { as, ...buttonProps } = props;
  return <Button type="button" className={classes} {...buttonProps} />;
}

import type { ComponentPropsWithRef } from "react";

export default function Button(props: ComponentPropsWithRef<"button">) {
  return <button {...props} />;
}

// Editor node views own their DOM lifecycle and must not mount a React root per button.
export function createButton(label: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  return button;
}

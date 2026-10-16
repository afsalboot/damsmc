"use client";

import { useEffect, useEffectEvent, useId, useRef } from "react";

const focusable = 'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
function layer(element) {
  let value = 0;
  for (let current = element; current; current = current.parentElement) {
    const index = Number.parseInt(getComputedStyle(current).zIndex, 10);
    if (Number.isFinite(index)) value = Math.max(value, index);
  }
  return value;
}
function topDialog() {
  return [...document.querySelectorAll('[role="dialog"],dialog[open]')].filter(visible)
    .sort((left, right) => layer(left) - layer(right)).at(-1);
}

// Shared behavior only; existing forms, callbacks, classes and payloads stay local.
export default function DialogSurface({ as: Tag = "section", onEscape, children, className = "", ...props }) {
  const ref = useRef(null), titleId = useId();
  const escapable = typeof onEscape === "function";
  const close = useEffectEvent(() => onEscape?.());
  useEffect(() => {
    const element = ref.current, previous = document.activeElement;
    const heading = element.querySelector("h1,h2,h3");
    if (!element.hasAttribute("aria-label") && !element.hasAttribute("aria-labelledby")) {
      if (heading) { heading.id ||= titleId; element.setAttribute("aria-labelledby", heading.id); }
      else element.setAttribute("aria-label", "Dialog");
    }
    const controls = () => [...element.querySelectorAll(focusable)].filter(control => visible(control) && control.tabIndex >= 0);
    const frame = requestAnimationFrame(() => {
      if (topDialog() === element && !element.contains(document.activeElement)) {
        const first = element.querySelector('[autofocus],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled)');
        (first && visible(first) ? first : controls()[0] || element).focus({ preventScroll: true });
      }
    });
    const keydown = event => {
      if (topDialog() !== element || event.defaultPrevented) return;
      if (event.key === "Escape" && escapable) {
        event.preventDefault(); event.stopImmediatePropagation(); close();
      } else if (event.key === "Tab") {
        const items = controls(), first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); element.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(frame); document.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [titleId, escapable]);
  return <Tag {...props} ref={ref} role="dialog" aria-modal="true" tabIndex={-1} className={`dialog-surface ${className}`}>{children}</Tag>;
}

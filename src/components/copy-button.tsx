"use client";

import { useEffect, useRef, useState } from "react";
import { DeskButton } from "./panel";

type State = "idle" | "copied" | "failed";

/**
 * Copies text, and says so.
 *
 * The confirmation is the whole point: a clipboard write is silent, and a
 * button that looks identical before and after leaves you pasting into
 * another window to find out whether it worked. It reverts on a timer so the
 * button is ready to mean something again the next time you press it.
 */
export function CopyButton({
  text,
  label = "COPY",
  title,
}: {
  /** Built lazily — the ticket text is only worth assembling on a click. */
  text: () => string;
  label?: string;
  title?: string;
}) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setState("copied");
    } catch {
      // Denied permission, or a context the API is not available in.
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1_400);
  };

  return (
    <DeskButton
      onClick={() => void copy()}
      variant={state === "failed" ? "danger" : "ghost"}
      title={
        state === "failed"
          ? "Clipboard unavailable — copy from the detail strip instead"
          : (title ?? "Copy this signal as a plain-text ticket")
      }
    >
      {state === "idle" ? label : state === "copied" ? "COPIED" : "FAILED"}
    </DeskButton>
  );
}

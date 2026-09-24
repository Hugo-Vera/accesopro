"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type Props = {
  label: string;
  text: string;
};

type Pos = { top: number; left: number; place: "below" | "above" };

export function HelpTip({ label, text }: Props) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = () => {
    pinnedRef.current = false;
    setOpen(false);
    setPinned(false);
  };

  const cancelLeave = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };

  const scheduleLeave = () => {
    cancelLeave();
    leaveTimer.current = setTimeout(() => {
      if (!pinnedRef.current) setOpen(false);
    }, 180);
  };

  useEscapeKey(close, open);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const placePanel = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 272;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const spaceBelow = window.innerHeight - r.bottom;
      const place: Pos["place"] = spaceBelow < 140 && r.top > spaceBelow ? "above" : "below";
      const top = place === "below" ? r.bottom + 6 : r.top - 6;
      setPos({ top, left, place });
    };
    placePanel();
    window.addEventListener("scroll", placePanel, true);
    window.addEventListener("resize", placePanel);
    return () => {
      window.removeEventListener("scroll", placePanel, true);
      window.removeEventListener("resize", placePanel);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      const panel = document.getElementById(panelId);
      if (panel?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, panelId]);

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex shrink-0"
      onMouseEnter={() => {
        cancelLeave();
        setOpen(true);
      }}
      onMouseLeave={scheduleLeave}
    >
      <button
        type="button"
        className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        aria-label={`Qué es: ${label}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pinnedRef.current) close();
          else {
            pinnedRef.current = true;
            setPinned(true);
            setOpen(true);
          }
        }}
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2.25} />
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <span
              id={panelId}
              role="tooltip"
              style={{
                position: "fixed",
                top: pos.place === "below" ? pos.top : undefined,
                bottom: pos.place === "above" ? window.innerHeight - pos.top : undefined,
                left: pos.left,
                width: 272,
              }}
              className="z-[70] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] leading-snug text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              onMouseEnter={cancelLeave}
              onMouseLeave={scheduleLeave}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

export function ActIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "house":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case "siren":
    case "emerg":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3l9 16H3L12 3z" />
          <path d="M12 10v4" />
          <circle cx="12" cy="17" r="1" />
        </svg>
      );
    case "trash":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
        </svg>
      );
    case "light":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case "water":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3c4 5 6 8 6 11a6 6 0 11-12 0c0-3 2-6 6-11z" />
        </svg>
      );
    case "floodlight":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 6l2 2" />
        </svg>
      );
    case "barrier":
    case "gate":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M3.5 21h5" />
          <path d="M6 21V9.5" />
          <path d="M4 5h4v5H4z" />
          <path d="M8 7.4h14" />
          <path d="M10.4 5.4l1.5 4M13.8 5.4l1.5 4M17.2 5.4l1.5 4M20.6 5.4l1.5 4" />
        </svg>
      );
    case "door":
    case "underground":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M6 21V4h12v17" />
          <path d="M6 21h12" />
          <path d="M15 12.5h.01" />
        </svg>
      );
    case "garage":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M3 10l9-6 9 6" />
          <path d="M5 10v10h14V10" />
          <path d="M5 14h14M5 17h14" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      );
  }
}

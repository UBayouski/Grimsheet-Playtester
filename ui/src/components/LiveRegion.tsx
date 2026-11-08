interface LiveRegionProps {
  message: string;
}

/** One polite live region for "Copied", the copy fallback message and "Results updated". */
export function LiveRegion({ message }: LiveRegionProps) {
  return (
    <div aria-live="polite" className="live">
      {message}
    </div>
  );
}
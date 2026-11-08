interface CopyButtonProps {
  /** The accessible name, which includes the level id: "Copy action list for 02-the-chaser". */
  label: string;
  /** The text to copy. */
  text: string;
  onCopy: (text: string) => void;
}

/** A button element. Its visible text is the label without the "for <level id>" part. */
export function CopyButton({ label, text, onCopy }: CopyButtonProps) {
  return (
    <button type="button" aria-label={label} onClick={() => onCopy(text)}>
      {label.replace(/ for .*$/s, '')}
    </button>
  );
}
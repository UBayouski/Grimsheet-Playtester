// Small total readers for untrusted JSON. A field with the wrong type reads as null; nothing is converted.

/** A non-null object that is not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string, or null for any other type. */
export function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A finite number, or null. A string such as "1" is not a number. */
export function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A finite integer that is at least 0, or null. */
export function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** `true` or `false`, or null for any other value. */
export function readBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Cuts a string to at most `max` UTF-16 code units, without leaving half of a surrogate pair. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/** The value of an own key, or null when the key is not an own key (the prototype chain is never read). */
export function getOwn(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor === undefined || !('value' in descriptor) ? null : descriptor.value;
}
/** Like getOwn, but undefined (not null) when the key is absent, so that "absent" and "null" can differ. */
export function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? getOwn(record, key) : undefined;
}
// The text of a failed request. One line, at most 200 characters, with secrets removed.
import { LIMITS } from './constants';
import { clip, isRecord } from './json';
import { REQUEST_FAILED, REQUEST_TOO_SLOW } from './text';

export const TIME_LIMIT_TEXT = REQUEST_TOO_SLOW;

/** The message of an error-like value, first line only, `token=` and `Bearer` values replaced, clipped. */
export function errorText(error: unknown): string {
  if (!isRecord(error) && !(error instanceof Error)) return REQUEST_FAILED;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return REQUEST_FAILED;
  const firstLine = (message.split(/\r?\n/)[0] ?? '').trim();
  if (firstLine === '') return REQUEST_FAILED;
  const redacted = firstLine.replace(/token=[^\s&]*/gi, 'token=…').replace(/Bearer\s+\S+/gi, 'Bearer …');
  return clip(redacted, LIMITS.textChars);
}
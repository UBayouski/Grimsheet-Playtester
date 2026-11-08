// The SDK is provided by the host. It is read as a namespace of unknown values and every export is checked with typeof
// before use, because a missing named export fails the whole module at link time (E09, E10).

export type SdkRecord = Readonly<Record<string, unknown>>;

/** The export called `name` when it is an own function of the record, otherwise null. */
export function pickFunction(sdk: SdkRecord | null | undefined, name: string): ((...args: never[]) => unknown) | null {
  if (sdk === null || sdk === undefined || !Object.prototype.hasOwnProperty.call(sdk, name)) return null;
  const value = sdk[name];
  return typeof value === 'function' ? (value as (...args: never[]) => unknown) : null;
}
/** Compare plugin JSON identities without rewriting persisted handles or native IDs. */
export function normalizeProviderSessionHandle(handle: string): string {
  if (!handle.startsWith("plugin:")) return handle;
  try {
    const value: unknown = JSON.parse(handle.slice("plugin:".length));
    return `plugin:${JSON.stringify(value, (_key, entry: unknown) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return entry;
      return Object.fromEntries(
        Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)),
      );
    })}`;
  } catch (error) {
    if (error instanceof SyntaxError) return handle;
    throw error;
  }
}

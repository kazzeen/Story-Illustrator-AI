export function readBooleanPreference(args: {
  storage: Storage | null | undefined;
  key: string;
  defaultValue: boolean;
}) {
  try {
    const raw = args.storage?.getItem(args.key);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return args.defaultValue;
  } catch {
    return args.defaultValue;
  }
}

export function writeBooleanPreference(args: { storage: Storage | null | undefined; key: string; value: boolean }) {
  try {
    args.storage?.setItem(args.key, args.value ? "true" : "false");
  } catch {
    return;
  }
}


import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ZodType } from "zod";

export function useLocalState<T>(
  key: string,
  initial: T,
  schema: ZodType<T>,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return initial;
      const parsed = schema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : initial;
    } catch {
      return initial;
    }
  });
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [key, value]);
  return [value, setValue, storageError];
}

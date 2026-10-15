"use client";

import { useEffect, useRef, useState } from "react";

type Codec<T> = {
  encode: (value: T) => unknown;
  decode: (raw: unknown) => T;
};

/**
 * useState that survives page refreshes (localStorage).
 *
 * A value equal to the initial/default is NOT stored, so untouched filters keep following their
 * defaults (e.g. "yesterday" stays relative to the current day) while anything the user actually
 * changed is restored exactly after a refresh.
 */
export function usePersistentState<T>(key: string, initial: T, codec?: Codec<T>, opts?: { ignoreStored?: boolean }) {
  const encode = codec?.encode ?? ((v: T) => v as unknown);
  const decode = codec?.decode ?? ((raw: unknown) => raw as T);

  const [value, setValue] = useState<T>(initial);
  const isHydratedRef = useRef(false);

  // Restore stored value after initial client mount to avoid SSR hydration mismatches
  useEffect(() => {
    if (opts?.ignoreStored) return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) {
        setValue(decode(JSON.parse(raw)));
      }
    } catch {
      // corrupted entry: keep default
    }
    isHydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const defaultJson = useRef(JSON.stringify(encode(initial)));

  useEffect(() => {
    if (!isHydratedRef.current) return;
    try {
      const json = JSON.stringify(encode(value));
      if (json === defaultJson.current) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, json);
    } catch {
      // storage unavailable / full: ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue] as const;
}

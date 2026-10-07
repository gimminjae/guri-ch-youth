"use client";
import { useEffect, useState } from "react";
import { api, messageOf } from "./api-client";

/** Ignore responses from superseded queries and derive loading from the request key. */
export function useApiResource<T>(path: string, body: unknown, enabled: boolean, revision = 0) {
  const serialized = JSON.stringify(body);
  const key = `${path}:${serialized}:${revision}`;
  const [result, setResult] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    api<T>(path, "POST", JSON.parse(serialized))
      .then((data) => { if (current) setResult({ key, data, error: "" }); })
      .catch((error) => { if (current) setResult({ key, data: null, error: messageOf(error) }); });
    return () => { current = false; };
  }, [path, serialized, enabled, key]);
  return { data: result.key === key ? result.data : null, error: result.key === key ? result.error : "", loading: enabled && result.key !== key };
}

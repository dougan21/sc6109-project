import { useEffect, useRef, useState } from "react";
import { message } from "./format";
export function usePoll<T>(
  loader: () => Promise<T>,
  key: string,
  interval = 3000,
) {
  const latest = useRef(loader);
  latest.current = loader;
  const [data, setData] = useState<T>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState<number>(),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    setData(undefined);
    setError("");
    setLoading(true);
    setUpdated(undefined);
    async function poll() {
      try {
        const result = await latest.current();
        if (active) {
          setData(result);
          setError("");
          setUpdated(Date.now());
        }
      } catch (e) {
        if (active) setError(message(e));
      } finally {
        if (active) {
          setLoading(false);
          if (interval) timer = setTimeout(poll, interval);
        }
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, interval, revision]);
  return {
    data,
    error,
    loading,
    updated,
    refresh: () => setRevision((r) => r + 1),
  };
}

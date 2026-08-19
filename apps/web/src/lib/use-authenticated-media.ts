"use client";

import { useEffect, useState } from "react";
import { clientApiBlobUrl, isAbortError, isProtectedFileUrl } from "@/lib/client-api";
import { useStableAuth } from "@/lib/use-app-auth";

/** Load protected `/api/v1/files/...` URLs as blob URLs for img/download use. */
export function useAuthenticatedMediaUrl(url: string | null | undefined): string | null {
  const { getTokenRef } = useStableAuth();
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setResolved(null);
      return;
    }
    if (!isProtectedFileUrl(url)) {
      setResolved(url);
      return;
    }

    const ac = new AbortController();
    let objectUrl: string | null = null;

    (async () => {
      try {
        const token = await getTokenRef.current();
        objectUrl = await clientApiBlobUrl(url, token, { signal: ac.signal });
        if (!ac.signal.aborted) setResolved(objectUrl);
      } catch (err) {
        if (!isAbortError(err) && !ac.signal.aborted) setResolved(null);
      }
    })();

    return () => {
      ac.abort();
      if (objectUrl?.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    };
  }, [url, getTokenRef]);

  return resolved;
}

"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useRef } from "react";
import { DEV_API_TOKEN, DEV_AUTH_BYPASS } from "@/lib/dev-auth";

function useClerkAppAuth() {
  const { isLoaded, isSignedIn, getToken: clerkGetToken } = useAuth();
  const getToken = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return null;
    return (await clerkGetToken()) ?? null;
  }, [clerkGetToken, isLoaded, isSignedIn]);
  return {
    isLoaded: Boolean(isLoaded),
    isSignedIn: Boolean(isSignedIn),
    getToken,
  };
}

function useDevAppAuth() {
  const getToken = useCallback(async () => DEV_API_TOKEN, []);
  return {
    isLoaded: true,
    isSignedIn: true,
    getToken,
  };
}

export const useAppAuth = DEV_AUTH_BYPASS ? useDevAppAuth : useClerkAppAuth;

/** Auth helpers with a stable ref for effects (avoids request loops on auth re-renders). */
export function useStableAuth() {
  const auth = useAppAuth();
  const getTokenRef = useRef(auth.getToken);
  getTokenRef.current = auth.getToken;
  return { ...auth, getTokenRef };
}

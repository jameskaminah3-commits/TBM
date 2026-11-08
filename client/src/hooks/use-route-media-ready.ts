import { type RefObject, useEffect, useRef, useState } from "react";

// A new page is covered by the loader while its code is still arriving, and
// for a moment while its first data loads, so it doesn't flash half-built.
// After that the page shows its own loading states. Photos never hold it up:
// each one fades in by itself when it arrives (ListingMedia).
const ROUTE_SETTLE_MS = 120;
const ROUTE_DATA_WAIT_MS = 900;
const ROUTE_CODE_TIMEOUT_MS = 10000;

export function useRouteMediaReady(
  location: string,
  containerRef: RefObject<HTMLElement>,
  blockingFetchCount: number,
) {
  const [isReady, setIsReady] = useState(false);
  const blockingFetchCountRef = useRef(blockingFetchCount);
  const rescanRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    blockingFetchCountRef.current = blockingFetchCount;
    rescanRef.current?.();
  }, [blockingFetchCount]);

  useEffect(() => {
    let cancelled = false;
    let dataWaitOver = false;
    let settleTimer: number | null = null;
    let observer: MutationObserver | null = null;

    setIsReady(false);

    const clearSettleTimer = () => {
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    const cleanup = () => {
      cancelled = true;
      clearSettleTimer();
      window.clearTimeout(dataTimer);
      window.clearTimeout(codeTimer);
      window.cancelAnimationFrame(frameHandle);
      observer?.disconnect();
      observer = null;
      rescanRef.current = null;
    };

    const finish = () => {
      if (cancelled) {
        return;
      }

      cleanup();
      setIsReady(true);
    };

    const rescan = () => {
      if (cancelled) {
        return;
      }

      clearSettleTimer();

      const container = containerRef.current;
      if (!container) {
        finish();
        return;
      }

      // The page's code is still loading.
      if (container.querySelector('[data-route-fallback="true"]')) {
        return;
      }

      if (blockingFetchCountRef.current > 0 && !dataWaitOver) {
        return;
      }

      settleTimer = window.setTimeout(finish, ROUTE_SETTLE_MS);
    };

    const container = containerRef.current;
    if (container) {
      observer = new MutationObserver(rescan);
      observer.observe(container, { subtree: true, childList: true });
    }

    const dataTimer = window.setTimeout(() => {
      dataWaitOver = true;
      rescan();
    }, ROUTE_DATA_WAIT_MS);
    const codeTimer = window.setTimeout(finish, ROUTE_CODE_TIMEOUT_MS);
    const frameHandle = window.requestAnimationFrame(rescan);
    rescanRef.current = rescan;

    return cleanup;
  }, [location, containerRef]);

  return isReady;
}

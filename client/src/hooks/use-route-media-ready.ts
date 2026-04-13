import { type RefObject, useEffect, useRef, useState } from "react";

const ROUTE_MEDIA_SETTLE_MS = 220;
const ROUTE_MEDIA_TIMEOUT_MS = 10000;

function shouldTrackImage(image: HTMLImageElement) {
  return image.getAttribute("loading") !== "lazy";
}

export function useRouteMediaReady(
  location: string,
  containerRef: RefObject<HTMLElement>,
  blockingFetchCount: number,
) {
  const [isReady, setIsReady] = useState(false);
  const blockingFetchCountRef = useRef(blockingFetchCount);
  const rescanRef = useRef<(() => void) | null>(null);
  const cycleRef = useRef(0);

  useEffect(() => {
    blockingFetchCountRef.current = blockingFetchCount;
    rescanRef.current?.();
  }, [blockingFetchCount]);

  useEffect(() => {
    cycleRef.current += 1;
    const cycle = cycleRef.current;
    const decodedImages = new WeakSet<HTMLImageElement>();
    const pendingPromises = new WeakMap<HTMLImageElement, Promise<void>>();
    let observer: MutationObserver | null = null;
    let settleTimer: number | null = null;
    let timeoutTimer: number | null = null;
    let frameHandle: number | null = null;
    let cancelled = false;

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

      if (timeoutTimer !== null) {
        window.clearTimeout(timeoutTimer);
      }

      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle);
      }

      observer?.disconnect();
      observer = null;
      rescanRef.current = null;
    };

    const finish = () => {
      if (cancelled || cycle !== cycleRef.current) {
        return;
      }

      cleanup();
      setIsReady(true);
    };

    const waitForRenderableImage = (image: HTMLImageElement) => {
      const cachedPromise = pendingPromises.get(image);
      if (cachedPromise) {
        return cachedPromise;
      }

      const promise = new Promise<void>((resolve) => {
        const markReady = () => {
          if (image.naturalWidth > 0) {
            if (typeof image.decode === "function") {
              image.decode().catch(() => undefined).finally(() => {
                decodedImages.add(image);
                resolve();
              });
              return;
            }

            decodedImages.add(image);
          }

          resolve();
        };

        if (image.complete) {
          markReady();
          return;
        }

        const handleDone = () => {
          image.removeEventListener("load", handleDone);
          image.removeEventListener("error", handleDone);
          markReady();
        };

        image.addEventListener("load", handleDone, { once: true });
        image.addEventListener("error", handleDone, { once: true });
      }).finally(() => {
        pendingPromises.delete(image);
      });

      pendingPromises.set(image, promise);
      return promise;
    };

    const isRenderable = (image: HTMLImageElement) => {
      if (!image.complete) {
        return false;
      }

      if (image.naturalWidth === 0) {
        return true;
      }

      return decodedImages.has(image) || typeof image.decode !== "function";
    };

    const rescan = () => {
      if (cancelled || cycle !== cycleRef.current) {
        return;
      }

      clearSettleTimer();

      const container = containerRef.current;
      if (!container) {
        finish();
        return;
      }

      if (container.querySelector('[data-route-fallback="true"]')) {
        return;
      }

      if (blockingFetchCountRef.current > 0) {
        return;
      }

      const eagerImages = Array.from(container.querySelectorAll("img")).filter(shouldTrackImage);
      if (eagerImages.length === 0) {
        settleTimer = window.setTimeout(finish, ROUTE_MEDIA_SETTLE_MS);
        return;
      }

      if (eagerImages.every(isRenderable)) {
        settleTimer = window.setTimeout(finish, ROUTE_MEDIA_SETTLE_MS);
        return;
      }

      Promise.allSettled(eagerImages.map(waitForRenderableImage)).then(() => {
        if (!cancelled && cycle === cycleRef.current) {
          rescan();
        }
      });
    };

    const container = containerRef.current;
    if (container) {
      observer = new MutationObserver(rescan);
      observer.observe(container, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["src", "srcset", "sizes", "loading"],
      });
    }

    timeoutTimer = window.setTimeout(finish, ROUTE_MEDIA_TIMEOUT_MS);
    frameHandle = window.requestAnimationFrame(rescan);
    rescanRef.current = rescan;

    return cleanup;
  }, [location, containerRef]);

  return isReady;
}

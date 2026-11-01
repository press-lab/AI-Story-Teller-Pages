import { flushSync } from "react-dom";

/** Commit feedback, then allow a frame to paint before synchronous preparation. */
export async function paintNarrationLoading(showLoading: () => void): Promise<void> {
  flushSync(showLoading);
  await new Promise<void>(resolve => {
    // Animation frames pause in background tabs; requests must still progress.
    if (document.visibilityState === "hidden") {
      setTimeout(resolve, 0);
      return;
    }
    let firstFrame = 0;
    let secondFrame = 0;
    const finish = () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resolve();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") finish();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    firstFrame = requestAnimationFrame(() => {
      // Resolving in the first rAF would resume microtasks before its paint.
      secondFrame = requestAnimationFrame(finish);
    });
  });
}

import { useEffect, useRef } from "react";
import { saveAdventure } from "../db/adventureDb";
import type { Adventure } from "../types/adventure";

export function useAdventureAutosave(
  adventure: Adventure | undefined,
  onSaveStatusChange: (status: string) => void,
  onSaved: () => void,
) {
  const onSaveStatusChangeRef = useRef(onSaveStatusChange);
  const onSavedRef = useRef(onSaved);
  // Update refs without re-running the save effect
  useEffect(() => { onSaveStatusChangeRef.current = onSaveStatusChange; });
  useEffect(() => { onSavedRef.current = onSaved; });

  useEffect(() => {
    if (!adventure) return;
    onSaveStatusChangeRef.current("saving");
    const timeout = window.setTimeout(() => {
      saveAdventure(adventure)
        .then(() => {
          onSaveStatusChangeRef.current("saved");
          onSavedRef.current();
        })
        .catch((saveError: unknown) =>
          onSaveStatusChangeRef.current(
            saveError instanceof Error ? saveError.message : "save failed",
          ),
        );
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [adventure]);
}

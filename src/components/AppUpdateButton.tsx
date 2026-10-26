import { useRef, useState } from "react";

interface AppUpdateButtonProps {
  disabled?: boolean;
  onUpdate: () => Promise<void>;
}

export function AppUpdateButton({ disabled, onUpdate }: AppUpdateButtonProps) {
  const updatingRef = useRef(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  async function update() {
    if (updatingRef.current) return;
    updatingRef.current = true;
    setUpdating(true);
    setError("");
    try {
      await onUpdate();
    } catch (cause) {
      setError(`Could not update app. Check your connection and try again. ${cause instanceof Error ? cause.message : ""}`);
    } finally {
      updatingRef.current = false;
      setUpdating(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="theme-toggle"
        disabled={disabled || updating}
        onClick={() => void update()}
        title="Save your adventure and reload the latest deployed app. Saved adventures and settings are kept."
      >
        {updating ? "Updating…" : "Update app"}
      </button>
      {error && <span role="alert" className="error-box">{error}</span>}
    </>
  );
}

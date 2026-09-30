import { useCallback, useState } from "react";
import { LivingTable } from "./games/livingtable/LivingTable";
import { openHub } from "./bridge/actions";

/**
 * The whole app is the Living Table. Its exit ("Back to the games") opens
 * Conjure Games in its own window when the hub is installed; when it is not
 * (or outside ConjureOS), the game restarts at its own campaign list instead
 * of leaving the player on a dead button.
 */
export function App() {
  const [run, setRun] = useState(0);
  const exit = useCallback(() => {
    void openHub().then((opened) => {
      if (!opened) setRun((n) => n + 1);
    });
  }, []);
  return (
    <main className="screen">
      <LivingTable key={run} onExit={exit} />
    </main>
  );
}

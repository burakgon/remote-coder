import { useState } from "react";
import { LoginScreen } from "./auth/LoginScreen";
import { loadToken, saveToken } from "./auth/token-store";

export function App() {
  const [token, setToken] = useState<string | undefined>(() => loadToken());

  if (token === undefined) {
    return (
      <LoginScreen
        onAuthenticated={(t) => {
          saveToken(t);
          setToken(t);
        }}
      />
    );
  }
  // Task 4 replaces this with the real session-list + chat layout.
  return <div>connected</div>;
}

// Dev-only entry for the real-component screenshot harness (screenshot.html). Mirrors main.tsx but
// seeds the store + auth token and mounts AppShot. Never referenced by the production entry.
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { saveToken } from "../auth/token-store";
import { AppShot } from "./AppShot";
import { seedStore, SCREENSHOT_TOKEN } from "./seed";

// Past the login screen (the real App reads this), and a fully-seeded store.
saveToken(SCREENSHOT_TOKEN);
seedStore();

// No StrictMode here: its dev double-invoke is irrelevant for a static capture and avoids any
// duplicate-effect flicker mid-screenshot.
createRoot(document.getElementById("root")!).render(<AppShot />);

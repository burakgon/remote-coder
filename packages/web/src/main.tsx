import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { MockupPage } from "./mockup/MockupPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MockupPage />
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "./components/theme-provider";
import { AgentProvider } from "./contexts/AgentContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AgentProvider>
        <App />
      </AgentProvider>
    </ThemeProvider>
  </StrictMode>,
);

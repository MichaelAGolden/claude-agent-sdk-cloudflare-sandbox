import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, SignedIn, SignedOut } from "@clerk/clerk-react";
import "./index.css";
import App from "./App.tsx";
import { SignInPage } from "./components/SignInPage.tsx";
import { ThemeProvider } from "./components/theme-provider";
import { AgentProvider } from "./contexts/AgentContext";
import { ThreadProvider } from "./contexts/ThreadContext";

// Get Clerk publishable key from environment
const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!CLERK_PUBLISHABLE_KEY) {
  console.warn("Missing VITE_CLERK_PUBLISHABLE_KEY - auth will be disabled");
}

function AuthenticatedApp() {
  return (
    <ThreadProvider>
      <AgentProvider>
        <App />
      </AgentProvider>
    </ThreadProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {CLERK_PUBLISHABLE_KEY ? (
        <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
          <SignedIn>
            <AuthenticatedApp />
          </SignedIn>
          <SignedOut>
            <SignInPage />
          </SignedOut>
        </ClerkProvider>
      ) : (
        // Fallback for development without Clerk
        <AuthenticatedApp />
      )}
    </ThemeProvider>
  </StrictMode>,
);

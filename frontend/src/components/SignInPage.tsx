import { SignIn } from "@clerk/clerk-react";
import { ModeToggle } from "./mode-toggle";

export function SignInPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Claude Agent SDK
        </h1>
        <p className="text-muted-foreground">
          Sign in to access your conversations
        </p>
      </div>

      <SignIn
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "bg-card border border-border shadow-lg",
          }
        }}
      />
    </div>
  );
}

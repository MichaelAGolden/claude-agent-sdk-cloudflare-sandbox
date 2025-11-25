import "./App.css";
import { UserButton } from "@clerk/clerk-react";
import { useAgent } from "./contexts/AgentContext";
import { useThreads } from "./contexts/ThreadContext";
import { ConnectionManager } from "./components/ConnectionManager";
import { ChatInterface } from "./components/ChatInterface";
import { ModeToggle } from "./components/mode-toggle";
import { ThreadListSidebar } from "./components/ThreadListSidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "./components/ui/sidebar";

function App() {
  const { state } = useAgent();
  const { state: threadState } = useThreads();

  return (
    <SidebarProvider>
      <ThreadListSidebar />
      <SidebarInset className="flex flex-col h-screen">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="flex-1 flex items-center gap-2">
            <h1 className="text-lg font-semibold">
              {threadState.currentThread?.title || "Claude Agent SDK"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionManager
              isConnected={state.isConnected}
              socketId={state.socketId}
            />
            <ModeToggle />
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>

        <main className="flex-1 min-h-0">
          <ChatInterface />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default App;

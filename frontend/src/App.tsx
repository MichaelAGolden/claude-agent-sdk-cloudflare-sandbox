import "./App.css";
import { useState, useEffect, useCallback } from "react";
import { UserButton } from "@clerk/clerk-react";
import { useAgent } from "./contexts/AgentContext";
import { useThreads } from "./contexts/ThreadContext";
import { FileExplorerProvider } from "./contexts/FileExplorerContext";
import { ConnectionManager } from "./components/ConnectionManager";
import { ChatInterface } from "./components/ChatInterface";
import { ModeToggle } from "./components/mode-toggle";
import { ThreadListSidebar } from "./components/ThreadListSidebar";
import { FileExplorerPanel, FileExplorerToggle } from "./components/FileExplorer";
import { ProjectSelector } from "./components/ProjectSelector";
import { ModelSelector } from "./components/ModelSelector";
import { CLAUDE_MODELS } from "./types";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "./components/ui/sidebar";

function App() {
  const { state, sessionId } = useAgent();
  const { state: threadState, updateThreadModel } = useThreads();
  const { currentThread, currentThreadId } = threadState;

  // Model selection state - synced with current thread
  const [selectedModel, setSelectedModel] = useState(
    currentThread?.model || CLAUDE_MODELS.SONNET_4_5
  );

  // Sync model when thread changes
  useEffect(() => {
    if (currentThread?.model) {
      setSelectedModel(currentThread.model);
    } else {
      setSelectedModel(CLAUDE_MODELS.SONNET_4_5);
    }
  }, [currentThread?.model, currentThreadId]);

  // Handle model change - update local state and persist to thread
  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model);
    if (currentThreadId) {
      updateThreadModel(currentThreadId, model);
    }
  }, [currentThreadId, updateThreadModel]);

  return (
    <FileExplorerProvider sessionId={sessionId}>
      <SidebarProvider>
        <ThreadListSidebar />
        <SidebarInset className="flex flex-col h-screen">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <ProjectSelector />
            <div className="h-4 w-px bg-border" />
            <div className="flex-1 flex items-center gap-2">
              <h1 className="text-lg font-semibold">
                {currentThread?.title || "Claude Agent SDK"}
              </h1>
            </div>
            <ModelSelector
              value={selectedModel}
              onChange={handleModelChange}
              disabled={state.isStreaming}
              compact
            />
            <div className="flex items-center gap-3">
              <ConnectionManager
                isConnected={state.isConnected}
                socketId={state.socketId}
              />
              <FileExplorerToggle />
              <ModeToggle />
              <UserButton afterSignOutUrl="/" />
            </div>
          </header>

          <main className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0">
              <ChatInterface />
            </div>
            <FileExplorerPanel />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </FileExplorerProvider>
  );
}

export default App;

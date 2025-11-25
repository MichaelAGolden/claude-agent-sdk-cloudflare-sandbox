import "./App.css";
import { useAgent } from "./contexts/AgentContext";
import { ConnectionManager } from "./components/ConnectionManager";
import { ChatInterface } from "./components/ChatInterface";
import { ModeToggle } from "./components/mode-toggle";

function App() {
  const { state } = useAgent();

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Claude Agent SDK Tester</h1>
        <div className="flex items-center gap-2">
          <ConnectionManager
            isConnected={state.isConnected}
            socketId={state.socketId}
          />
          <ModeToggle />
        </div>
      </header>

      <main className="app-main-simple">
        <ChatInterface />
      </main>
    </div>
  );
}

export default App;

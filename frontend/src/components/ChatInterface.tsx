import { AgentRuntimeProvider } from "./AgentRuntimeProvider";
import { Thread } from "./assistant-ui/thread";

export function ChatInterface() {
  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      <AgentRuntimeProvider>
        <Thread />
      </AgentRuntimeProvider>
    </div>
  );
}

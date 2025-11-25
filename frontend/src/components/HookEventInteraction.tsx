import React from "react";
import type { Message } from "../types";

interface HookEventInteractionProps {
  message: Message;
  onResolve: (requestId: string, result: any) => void;
}

export const HookEventInteraction: React.FC<HookEventInteractionProps> = ({
  message,
  onResolve,
}) => {
  const isPending = message.interactionState === "pending";
  const { interactionType, interactionData, interactionResult } = message;

  return (
    <div className={`inline-interaction ${!isPending ? "resolved" : ""}`}>
      <div className="interaction-header">
        <strong>Hook Event: {interactionData.event}</strong>
      </div>
      <div className="interaction-body">
        <pre>{JSON.stringify(interactionData.data, null, 2)}</pre>
      </div>
      <div className="interaction-actions">
        {isPending ? (
          <>
            <button
              onClick={() =>
                onResolve(message.requestId!, { action: "continue" })
              }
              className="btn-continue"
            >
              Continue
            </button>
            <button
              onClick={() => onResolve(message.requestId!, { action: "stop" })}
              className="btn-stop"
            >
              Stop
            </button>
          </>
        ) : (
          <div className="interaction-result">
            {interactionType === "hook_notification"
              ? "Auto-continued"
              : `Resolved: ${interactionResult?.action || "Unknown"}`}
          </div>
        )}
      </div>
    </div>
  );
};

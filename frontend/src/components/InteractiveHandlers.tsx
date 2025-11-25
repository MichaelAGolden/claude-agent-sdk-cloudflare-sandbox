import React from "react";
import type { Message } from "../types";
import { HookEventInteraction } from "./HookEventInteraction";

export interface Props {
  message: Message;
  onResolve: (requestId: string, result: any) => void;
}

export const InlineInteraction: React.FC<Props> = ({ message, onResolve }) => {
  const { interactionType } = message;

  if (
    interactionType === "hook_request" ||
    interactionType === "hook_notification"
  ) {
    return <HookEventInteraction message={message} onResolve={onResolve} />;
  }

  return (
    <div className="inline-interaction">
      <p>Unknown interaction type: {interactionType}</p>
    </div>
  );
};

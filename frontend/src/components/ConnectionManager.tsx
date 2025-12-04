import React from "react";
import { Cable, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  isConnected: boolean;
  socketId: string | null;
}

export const ConnectionManager: React.FC<Props> = ({
  isConnected,
  socketId,
}) => {
  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={isConnected ? "default" : "destructive"}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 transition-all duration-300 cursor-help",
              isConnected
                ? "bg-green-500/15 text-green-600 hover:bg-green-500/25 border-green-200 dark:bg-green-500/20 dark:text-green-400 dark:border-green-800"
                : "dark:bg-red-500/20 dark:text-red-400 dark:border-red-800"
            )}
          >
            {isConnected ? <Cable size={14} /> : <Unplug size={14} />}
            <span>{isConnected ? "Connected" : "Disconnected"}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="font-medium">
            {isConnected ? "Server Connected" : "Server Disconnected"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isConnected
              ? "You have an active WebSocket connection to the agent server. Messages will be sent and received in real-time."
              : "No connection to the agent server. Check your network or try refreshing the page."}
          </p>
        </TooltipContent>
      </Tooltip>
      {socketId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground font-mono hidden sm:inline-block cursor-help">
              ID: {socketId}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-medium">Session ID</p>
            <p className="text-xs text-muted-foreground">
              Unique identifier for your current WebSocket connection to the agent server
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};

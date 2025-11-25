import React from "react";
import { Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
      <Badge
        variant={isConnected ? "default" : "destructive"}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 transition-all duration-300",
          isConnected ? "bg-green-500/15 text-green-600 hover:bg-green-500/25 border-green-200" : ""
        )}
      >
        {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
        <span>{isConnected ? "Connected" : "Disconnected"}</span>
      </Badge>
      {socketId && (
        <span className="text-xs text-muted-foreground font-mono hidden sm:inline-block">
          ID: {socketId.slice(0, 6)}...
        </span>
      )}
    </div>
  );
};

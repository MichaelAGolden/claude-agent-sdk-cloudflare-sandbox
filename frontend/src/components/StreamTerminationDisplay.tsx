import { useState } from 'react';
import { ChevronRight, ChevronDown, CheckCircle2, XCircle, AlertTriangle, WifiOff, HelpCircle } from 'lucide-react';
import type { StreamTerminationInfo } from '../types/index.ts';

interface StreamTerminationDisplayProps {
  termination: StreamTerminationInfo;
}

// Icon and color mapping for different termination reasons
const terminationConfig: Record<StreamTerminationInfo['reason'], {
  icon: typeof CheckCircle2;
  color: string;
  bgColor: string;
  label: string;
}> = {
  completed: {
    icon: CheckCircle2,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10 border-green-500/20',
    label: 'Completed'
  },
  error: {
    icon: XCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10 border-red-500/20',
    label: 'Error'
  },
  interrupted: {
    icon: AlertTriangle,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10 border-yellow-500/20',
    label: 'Interrupted'
  },
  disconnected: {
    icon: WifiOff,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10 border-orange-500/20',
    label: 'Disconnected'
  },
  unknown: {
    icon: HelpCircle,
    color: 'text-gray-500',
    bgColor: 'bg-gray-500/10 border-gray-500/20',
    label: 'Unknown'
  },
};

export function StreamTerminationDisplay({ termination }: StreamTerminationDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const config = terminationConfig[termination.reason] || terminationConfig.unknown;
  const Icon = config.icon;
  const timestamp = new Date(termination.timestamp).toLocaleTimeString();

  // Don't show UI for normal completions - only show for errors/issues
  if (termination.reason === 'completed') {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-[var(--thread-max-width)] px-2 py-1">
      <div className={`rounded-lg border ${config.bgColor} text-xs`}>
        {/* Collapsed header - always visible */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors rounded-lg"
        >
          {/* Expand/collapse chevron */}
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}

          {/* Status icon */}
          <Icon className={`h-4 w-4 ${config.color} flex-shrink-0`} />

          {/* Status label */}
          <span className={`font-medium ${config.color}`}>{config.label}</span>

          {/* Message preview */}
          <span className="text-muted-foreground">·</span>
          <span className="text-foreground/80 truncate flex-1">{termination.message}</span>

          {/* Timestamp */}
          <span className="text-muted-foreground/60 text-[10px] flex-shrink-0">{timestamp}</span>
        </button>

        {/* Expanded details */}
        {isExpanded && (
          <div className="border-t border-border/50 px-3 py-2 space-y-2">
            {/* Full message */}
            <div>
              <div className="text-[10px] font-medium text-muted-foreground uppercase mb-1">
                Message
              </div>
              <div className="text-sm text-foreground/90">{termination.message}</div>
            </div>

            {/* Reason */}
            <div>
              <div className="text-[10px] font-medium text-muted-foreground uppercase mb-1">
                Reason
              </div>
              <div className={`text-sm font-medium ${config.color}`}>{termination.reason}</div>
            </div>

            {/* Details (if any) */}
            {termination.details && Object.keys(termination.details).length > 0 && (
              <div>
                <div className="text-[10px] font-medium text-muted-foreground uppercase mb-1">
                  Details
                </div>
                <pre className="text-[11px] bg-background/50 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
                  {JSON.stringify(termination.details, null, 2)}
                </pre>
              </div>
            )}

            {/* Timestamp */}
            <div>
              <div className="text-[10px] font-medium text-muted-foreground uppercase mb-1">
                Timestamp
              </div>
              <div className="text-[11px] text-muted-foreground">
                {new Date(termination.timestamp).toISOString()}
              </div>
            </div>

            {/* Help text based on reason */}
            <div className="pt-2 border-t border-border/30">
              <div className="text-[11px] text-muted-foreground">
                {termination.reason === 'error' && (
                  <>An error occurred. Check the details above for more information. You may need to retry your request.</>
                )}
                {termination.reason === 'interrupted' && (
                  <>The agent was interrupted. You can send a new message to continue.</>
                )}
                {termination.reason === 'disconnected' && (
                  <>Connection was lost. The page will attempt to reconnect automatically. If the problem persists, try refreshing.</>
                )}
                {termination.reason === 'unknown' && (
                  <>The agent stopped for an unknown reason. Please try again or report this issue.</>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

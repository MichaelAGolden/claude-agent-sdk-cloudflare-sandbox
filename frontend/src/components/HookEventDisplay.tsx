import { useState } from 'react';
import { ChevronRight, ChevronDown, Wrench, Play, Square, Bell, User, Zap, LogOut, Minimize2, Terminal } from 'lucide-react';
import type { HookEvent, HookEventType } from '../types/index.ts';
import { StandaloneMarkdown } from './assistant-ui/standalone-markdown';

interface HookEventDisplayProps {
  hookEvent: HookEvent;
}

// Icon and color mapping for different hook types
const hookConfig: Record<HookEventType, { icon: typeof Wrench; color: string; label: string }> = {
  PreToolUse: { icon: Wrench, color: 'text-blue-500', label: 'Pre Tool Use' },
  PostToolUse: { icon: Wrench, color: 'text-green-500', label: 'Post Tool Use' },
  Notification: { icon: Bell, color: 'text-yellow-500', label: 'Notification' },
  UserPromptSubmit: { icon: User, color: 'text-purple-500', label: 'User Prompt' },
  SessionStart: { icon: Play, color: 'text-emerald-500', label: 'Session Start' },
  SessionEnd: { icon: LogOut, color: 'text-red-500', label: 'Session End' },
  Stop: { icon: Square, color: 'text-orange-500', label: 'Stop' },
  SubagentStop: { icon: Square, color: 'text-orange-400', label: 'Subagent Stop' },
  PreCompact: { icon: Minimize2, color: 'text-gray-500', label: 'Pre Compact' },
  SkillCommand: { icon: Terminal, color: 'text-indigo-500', label: 'Skill Execution' },
};

// Extract a brief summary from hook data
function getHookSummary(eventType: HookEventType, data: any): string {
  if (!data) return '';

  switch (eventType) {
    case 'PreToolUse':
    case 'PostToolUse':
      return data.tool_name || data.toolName || data.name || '';
    case 'Notification':
      return data.message?.substring(0, 50) || '';
    case 'Stop':
    case 'SubagentStop':
      return data.reason || '';
    case 'SkillCommand':
      if (typeof data.content === 'string') {
        // Try to extract command name from XML
        const match = data.content.match(/<command-name>(.*?)<\/command-name>/);
        if (match) return match[1];
        
        // Fallback to command message
        const msgMatch = data.content.match(/<command-message>(.*?)<\/command-message>/);
        if (msgMatch) return msgMatch[1];
        
        return 'Command output';
      }
      return '';
    default:
      return '';
  }
}

export function HookEventDisplay({ hookEvent }: HookEventDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const config = hookConfig[hookEvent.eventType] || {
    icon: Zap,
    color: 'text-gray-500',
    label: hookEvent.eventType,
  };

  const Icon = config.icon;
  const summary = getHookSummary(hookEvent.eventType, hookEvent.data);
  const timestamp = new Date(hookEvent.timestamp).toLocaleTimeString();

  return (
    <div className="mx-auto w-full max-w-[var(--thread-max-width)] px-2 py-1">
      <div className="rounded-lg border border-border/50 bg-muted/30 text-xs">
        {/* Collapsed header - always visible */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors rounded-lg"
        >
          {/* Expand/collapse chevron */}
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}

          {/* Hook type icon */}
          <Icon className={`h-3.5 w-3.5 ${config.color} flex-shrink-0`} />

          {/* Hook label */}
          <span className={`font-medium ${config.color}`}>{config.label}</span>

          {/* Summary (tool name, message preview, etc.) */}
          {summary && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground truncate">{summary}</span>
            </>
          )}

          {/* Spacer */}
          <span className="flex-1" />

          {/* Request badge */}
          {hookEvent.isRequest && (
            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">
              request
            </span>
          )}

          {/* Timestamp */}
          <span className="text-muted-foreground/60 text-[10px]">{timestamp}</span>
        </button>

        {/* Expanded details */}
        {isExpanded && (
          <div className="border-t border-border/50 px-3 py-2 space-y-2">
            {/* Hook data */}
            {hookEvent.eventType === 'SkillCommand' ? (
              // Special rendering for SkillCommand: Show formatted markdown
              <div className="max-h-[60vh] overflow-y-auto">
                 <div className="text-[10px] font-medium text-muted-foreground uppercase mb-1">
                  Output
                </div>
                <StandaloneMarkdown content={hookEvent.data?.content || ''} className="text-xs" />
              </div>
            ) : (
              // Default rendering for other hooks
              hookEvent.data && Object.keys(hookEvent.data).length > 0 && (
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground uppercase mb-1">
                    Data
                  </div>
                  <pre className="text-[11px] bg-background/50 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
                    {JSON.stringify(hookEvent.data, null, 2)}
                  </pre>
                </div>
              )
            )}

            {/* Response (for hook_request) */}
            {hookEvent.isRequest && hookEvent.response && (
              <div>
                <div className="text-[10px] font-medium text-muted-foreground uppercase mb-1">
                  Response
                </div>
                <pre className="text-[11px] bg-green-500/5 rounded p-2 overflow-x-auto">
                  {JSON.stringify(hookEvent.response, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

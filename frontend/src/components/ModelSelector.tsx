/**
 * @fileoverview Compact model selector component for the chat header.
 *
 * Enables seamless model switching mid-thread. The selected model
 * is passed with each message to the backend.
 */

import React from "react";
import { CLAUDE_MODELS, MODEL_DISPLAY_NAMES } from "../types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Zap, Brain } from "lucide-react";

interface Props {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

/**
 * Model configuration with icons and descriptions.
 * Only 4.5 series models are available per user configuration.
 */
const MODEL_CONFIG = [
  {
    id: CLAUDE_MODELS.SONNET_4_5,
    icon: Sparkles,
    shortName: "Sonnet 4.5",
    description: "Best for complex tasks and coding",
  },
  {
    id: CLAUDE_MODELS.HAIKU_4_5,
    icon: Zap,
    shortName: "Haiku 4.5",
    description: "Fastest, near-frontier intelligence",
  },
  {
    id: CLAUDE_MODELS.OPUS_4_5,
    icon: Brain,
    shortName: "Opus 4.5",
    description: "Maximum intelligence",
  },
];

/**
 * Get display info for a model ID.
 */
const getModelInfo = (modelId: string) => {
  return MODEL_CONFIG.find(m => m.id === modelId) || {
    id: modelId,
    icon: Sparkles,
    shortName: MODEL_DISPLAY_NAMES[modelId] || modelId,
    description: "",
  };
};

export const ModelSelector: React.FC<Props> = ({
  value,
  onChange,
  disabled = false,
  compact = false,
}) => {
  const currentModel = getModelInfo(value || CLAUDE_MODELS.SONNET_4_5);
  const CurrentIcon = currentModel.icon;

  return (
    <Select
      value={value || CLAUDE_MODELS.SONNET_4_5}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger
        className={compact
          ? "h-8 w-auto min-w-[140px] border-0 bg-transparent hover:bg-accent/50 focus:ring-0 focus:ring-offset-0"
          : "w-full"
        }
      >
        <div className="flex items-center gap-2">
          <CurrentIcon className="h-4 w-4 text-muted-foreground" />
          <SelectValue placeholder="Select model">
            {currentModel.shortName}
          </SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent align="start">
        {MODEL_CONFIG.map((model) => {
          const Icon = model.icon;
          return (
            <SelectItem key={model.id} value={model.id}>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span>{model.shortName}</span>
                  {!compact && (
                    <span className="text-xs text-muted-foreground">
                      {model.description}
                    </span>
                  )}
                </div>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};

export default ModelSelector;

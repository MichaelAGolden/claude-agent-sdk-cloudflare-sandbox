import React, { useState } from "react";
import { CLAUDE_MODELS, MODEL_DISPLAY_NAMES, type ExtendedOptions } from "../types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Settings2, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  options: ExtendedOptions;
  onChange: (options: ExtendedOptions) => void;
}

/**
 * Available models for the configuration panel.
 * Shows current frontier models first, then legacy models.
 */
const AVAILABLE_MODELS = [
  // Current frontier models (4.5 series)
  { id: CLAUDE_MODELS.SONNET_4_5, group: "Current" },
  { id: CLAUDE_MODELS.HAIKU_4_5, group: "Current" },
  { id: CLAUDE_MODELS.OPUS_4_5, group: "Current" },
  // Legacy models
  { id: CLAUDE_MODELS.OPUS_4_1, group: "Legacy" },
  { id: CLAUDE_MODELS.SONNET_4, group: "Legacy" },
  { id: CLAUDE_MODELS.SONNET_3_7, group: "Legacy" },
  { id: CLAUDE_MODELS.HAIKU_3_5, group: "Legacy" },
];

export const ConfigurationPanel: React.FC<Props> = ({ options, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleChange = (key: keyof ExtendedOptions, value: any) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <Card className="w-full border-none shadow-none bg-transparent">
      <CardHeader className="px-0 py-2">
        <Button
          variant="ghost"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex justify-between items-center px-2 hover:bg-accent/50"
        >
          <div className="flex items-center gap-2">
            <Settings2 size={18} />
            <span className="font-semibold">Configuration</span>
          </div>
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </Button>
      </CardHeader>

      {isOpen && (
        <CardContent className="px-2 pb-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Select
              value={options.model || CLAUDE_MODELS.SONNET_4_5}
              onValueChange={(value) => handleChange("model", value)}
            >
              <SelectTrigger id="model">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {/* Current models */}
                <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Current</div>
                {AVAILABLE_MODELS.filter(m => m.group === "Current").map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {MODEL_DISPLAY_NAMES[model.id] || model.id}
                  </SelectItem>
                ))}
                {/* Legacy models */}
                <div className="px-2 py-1 text-xs text-muted-foreground font-medium mt-2">Legacy</div>
                {AVAILABLE_MODELS.filter(m => m.group === "Legacy").map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {MODEL_DISPLAY_NAMES[model.id] || model.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="systemPrompt">System Prompt</Label>
            <Textarea
              id="systemPrompt"
              value={options.systemPrompt || ""}
              onChange={(e) => handleChange("systemPrompt", e.target.value)}
              placeholder="Enter system instructions..."
              className="min-h-[100px] resize-y"
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
};

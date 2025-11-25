import React, { useState } from "react";
import type { ExtendedOptions } from "../types";
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
              value={options.model || "claude-sonnet-4-5-20250929"}
              onValueChange={(value) => handleChange("model", value)}
            >
              <SelectTrigger id="model">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-sonnet-4-5-20250929">
                  claude-sonnet-4-5
                </SelectItem>
                <SelectItem value="claude-haiku-4-5-20251001">
                  claude-haiku-4-5
                </SelectItem>
                <SelectItem value="claude-opus-4-1-20250805">
                  claude-opus-4-1
                </SelectItem>
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

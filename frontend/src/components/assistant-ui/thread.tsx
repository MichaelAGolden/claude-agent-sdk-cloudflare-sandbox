import {
  ArrowDownIcon,
  ArrowUpIcon,
  Square,
} from "lucide-react";

import {
  ComposerPrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";

import type { FC } from "react";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import * as m from "motion/react-m";

import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  ComposerAddAttachment,
  ComposerAttachments,
} from "@/components/assistant-ui/attachment";
import { ThreadMessages } from "@/components/assistant-ui/thread-messages";

export const Thread: FC = () => {
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <ThreadPrimitive.Root
          className="aui-root aui-thread-root @container flex flex-1 min-h-0 flex-col bg-background"
          style={{
            ["--thread-max-width" as string]: "48rem",
          }}
        >
          <ThreadPrimitive.Viewport className="aui-thread-viewport flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden scroll-smooth px-5 md:px-8" autoScroll>
            <ThreadPrimitive.If empty>
              <ThreadWelcome />
            </ThreadPrimitive.If>

            {/* Custom messages renderer that includes hooks inline chronologically */}
            <ThreadMessages />

            <ThreadPrimitive.If empty={false}>
              <div className="aui-thread-viewport-spacer min-h-8 grow" />
            </ThreadPrimitive.If>
          </ThreadPrimitive.Viewport>

          <Composer />
        </ThreadPrimitive.Root>
      </MotionConfig>
    </LazyMotion>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 left-1/2 z-10 -translate-x-1/2 rounded-full bg-background p-4 disabled:invisible dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col">
      <div className="aui-thread-welcome-center flex w-full flex-grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-4">
          {/* Header */}
          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mb-6"
          >
            <h1 className="text-2xl font-semibold mb-2">Claude Agent SDK</h1>
            <p className="text-muted-foreground">
              An AI assistant with agentic capabilities running in a secure sandbox environment.
            </p>
          </m.div>

          {/* Capabilities */}
          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
              What can it do?
            </h2>
            <div className="grid gap-2 text-sm">
              <div className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span><span className="font-medium">Execute code</span> — Run Python, JavaScript, and shell commands</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span><span className="font-medium">File operations</span> — Read, write, and edit files in the sandbox</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span><span className="font-medium">Web access</span> — Fetch data and search the web</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span><span className="font-medium">Multi-turn conversations</span> — Context preserved across messages</span>
              </div>
            </div>
          </m.div>
        </div>
      </div>
      <ThreadSuggestions />
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  const suggestions = [
    {
      title: "Generate fractal art",
      label: "Create a Mandelbrot set image",
      action: "Generate a beautiful Mandelbrot set fractal image using Python and display it",
    },
    {
      title: "Write and run code",
      label: "Create a Python script that generates fibonacci numbers",
      action: "Write a Python script that generates the first 20 fibonacci numbers and run it",
    },
    {
      title: "Analyze data",
      label: "Help me process a CSV file",
      action: "I have some data I'd like to analyze. Can you help me write a script to process it?",
    },
    {
      title: "Explain concepts",
      label: "How does async/await work?",
      action: "Explain how async/await works in JavaScript with practical examples",
    },
  ];

  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.2 }}
      className="px-4 pb-4"
    >
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
        Try asking
      </h2>
      <div className="aui-thread-welcome-suggestions grid w-full gap-2 @md:grid-cols-2">
        {suggestions.map((suggestion, index) => (
          <ThreadPrimitive.Suggestion
            key={`suggestion-${index}`}
            prompt={suggestion.action}
            send
            asChild
          >
            <Button
              variant="ghost"
              className="aui-thread-welcome-suggestion h-auto w-full flex-col items-start justify-start gap-0.5 rounded-xl border bg-card px-4 py-3 text-left text-sm hover:bg-accent/50 dark:hover:bg-accent/30"
              aria-label={suggestion.action}
            >
              <span className="font-medium">{suggestion.title}</span>
              <span className="text-muted-foreground text-xs">{suggestion.label}</span>
            </Button>
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </m.div>
  );
};

const Composer: FC = () => {
  return (
    <div className="aui-composer-wrapper sticky bottom-0 mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col overflow-visible px-5 pb-4 md:px-8 md:pb-6">
      <ThreadScrollToBottom />
      <ComposerPrimitive.Root className="aui-composer-root group/input-group relative flex w-full flex-col rounded-3xl border border-input bg-background px-1 pt-2 shadow-xs transition-[color,box-shadow] outline-none has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-[3px] has-[textarea:focus-visible]:ring-ring/50">
        <ComposerAttachments />
        <ComposerPrimitive.Input
          placeholder="Send a message..."
          className="aui-composer-input mb-1 max-h-32 min-h-16 w-full resize-none bg-transparent px-3.5 pt-1.5 pb-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-0"
          rows={1}
          autoFocus
          aria-label="Message input"
        />
        <ComposerAction />
      </ComposerPrimitive.Root>
    </div>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative mx-1 mt-2 mb-2 flex items-center justify-between">
      <ComposerAddAttachment />

      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="submit"
            variant="default"
            size="icon"
            className="aui-composer-send size-[34px] rounded-full p-1"
            aria-label="Send message"
          >
            <ArrowUpIcon className="aui-composer-send-icon size-5" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>

      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel size-[34px] rounded-full border border-muted-foreground/60 hover:bg-primary/75 dark:border-muted-foreground/90"
            aria-label="Stop generating"
          >
            <Square className="aui-composer-cancel-icon size-3.5 fill-primary-foreground" />
          </Button>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </div>
  );
};

// MessageError, AssistantActionBar, UserMessage, UserActionBar, EditComposer, BranchPicker
// These components are kept for reference but we use ThreadMessages for custom rendering
// See thread-messages.tsx for the active implementation

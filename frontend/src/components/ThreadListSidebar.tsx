import { useState } from "react";
import { PlusIcon, TrashIcon, MessageSquareIcon, PencilIcon, CheckIcon, XIcon, MoreHorizontalIcon } from "lucide-react";
import { useThreads } from "@/contexts/ThreadContext";
import { useAgent } from "@/contexts/AgentContext";
import { ConfirmThreadSwitch } from "@/components/ConfirmThreadSwitch";
import { ConfirmDeleteThread } from "@/components/ConfirmDeleteThread";
import { SkillsManager } from "@/components/SkillsManager";
import { AgentsManager } from "@/components/AgentsManager";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function ThreadListSidebar() {
  const { state, filteredThreads, createThread, deleteThread, requestThreadSwitch, cancelPendingSwitch, confirmPendingSwitch, updateThreadTitle } = useThreads();
  const { currentThreadId, isLoading, pendingSwitch } = state;

  const { state: agentState, interruptForSwitch } = useAgent();
  const { isStreaming } = agentState;

  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [pendingDeleteThread, setPendingDeleteThread] = useState<{ id: string; title: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSwitchThread = (threadId: string) => {
    if (threadId === currentThreadId) return;
    requestThreadSwitch(threadId, isStreaming);
  };

  const handleConfirmSwitch = async () => {
    // Interrupt current conversation if streaming
    if (isStreaming && currentThreadId) {
      await interruptForSwitch(currentThreadId);
    }
    // Execute the switch
    await confirmPendingSwitch();
  };

  const handleNewThread = async () => {
    await createThread();
  };

  const handleCancelDelete = () => {
    setPendingDeleteThread(null);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteThread) return;
    setIsDeleting(true);
    try {
      await deleteThread(pendingDeleteThread.id);
    } finally {
      setIsDeleting(false);
      setPendingDeleteThread(null);
    }
  };

  const handleSaveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editingThreadId && editTitle.trim()) {
      await updateThreadTitle(editingThreadId, editTitle.trim());
    }
    setEditingThreadId(null);
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingThreadId(null);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b">
        <div className="flex items-center justify-between px-2 py-2">
          <span className="font-semibold">Conversations</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNewThread}
            title="New conversation"
          >
            <PlusIcon className="h-4 w-4" />
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Recent</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                // Loading skeletons
                <>
                  {[1, 2, 3].map((i) => (
                    <SidebarMenuItem key={i}>
                      <div className="flex flex-col gap-1 p-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </SidebarMenuItem>
                  ))}
                </>
              ) : filteredThreads.length === 0 ? (
                // Empty state
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  <MessageSquareIcon className="mx-auto h-8 w-8 mb-2 opacity-50" />
                  <p>No conversations yet</p>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={handleNewThread}
                    className="mt-2"
                  >
                    Start a new conversation
                  </Button>
                </div>
              ) : (
                // Thread list
                filteredThreads.map((thread) => (
                  <SidebarMenuItem key={thread.id}>
                    <SidebarMenuButton
                      onClick={() => handleSwitchThread(thread.id)}
                      isActive={currentThreadId === thread.id}
                      className={cn(
                        "flex flex-col items-start gap-0.5 h-auto py-2",
                        currentThreadId === thread.id && "bg-accent"
                      )}
                    >
                      {editingThreadId === thread.id ? (
                        // Edit mode
                        <div
                          className="flex w-full items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="h-6 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(e as unknown as React.MouseEvent);
                              if (e.key === "Escape") handleCancelEdit(e as unknown as React.MouseEvent);
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={handleSaveEdit}
                          >
                            <CheckIcon className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={handleCancelEdit}
                          >
                            <XIcon className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        // Display mode
                        <>
                          <span className="truncate font-medium">
                            {thread.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(thread.updated_at)}
                          </span>
                        </>
                      )}
                    </SidebarMenuButton>

                    {/* Actions dropdown - only show when not editing */}
                    {editingThreadId !== thread.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover/menu-item:opacity-100 focus:opacity-100",
                              currentThreadId === thread.id && "opacity-100"
                            )}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontalIcon className="h-4 w-4" />
                            <span className="sr-only">Thread actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingThreadId(thread.id);
                              setEditTitle(thread.title);
                            }}
                          >
                            <PencilIcon className="mr-2 h-4 w-4" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDeleteThread(thread);
                            }}
                          >
                            <TrashIcon className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Skills Management Section */}
        <SkillsManager />

        {/* Agents Management Section */}
        <AgentsManager />
      </SidebarContent>

      <SidebarFooter className="border-t">
        <div className="px-4 py-2 text-xs text-muted-foreground">
          {filteredThreads.length} conversation{filteredThreads.length !== 1 ? "s" : ""}
        </div>
      </SidebarFooter>

      {/* Confirmation dialog for switching during active conversation */}
      <ConfirmThreadSwitch
        isOpen={!!pendingSwitch}
        targetThreadTitle={pendingSwitch?.targetThread.title || ''}
        onCancel={cancelPendingSwitch}
        onConfirm={handleConfirmSwitch}
      />

      {/* Confirmation dialog for deleting a thread */}
      <ConfirmDeleteThread
        isOpen={!!pendingDeleteThread}
        threadTitle={pendingDeleteThread?.title || ''}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
    </Sidebar>
  );
}

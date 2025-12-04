import { useState } from "react";
import {
  PlusIcon,
  TrashIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  RefreshCwIcon,
  GlobeIcon,
  FolderIcon,
  WrenchIcon,
  SparklesIcon,
  ZapIcon,
  BrainIcon,
} from "lucide-react";
import { useAgents, type Agent, type AgentScope } from "@/contexts/AgentsContext";
import { useProjects } from "@/contexts/ProjectContext";
import type { AgentDefinition, ModelAlias } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

// Default agent template
const DEFAULT_AGENT: AgentDefinition = {
  description: "Use this agent when the user asks to [describe trigger conditions]",
  prompt: `You are a specialized agent for [specific task].

## Your Role
[Describe the agent's purpose and expertise]

## Guidelines
1. [First guideline]
2. [Second guideline]
3. [Third guideline]

## Output Format
[Describe how the agent should format its responses]`,
  tools: [],
  model: undefined,
};

// Available tools that can be assigned to agents
const AVAILABLE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
];

// Model options for agents
const MODEL_OPTIONS: { value: ModelAlias | 'inherit'; label: string; icon: typeof SparklesIcon; description: string }[] = [
  { value: 'inherit', label: 'Inherit', icon: SparklesIcon, description: 'Use the main model' },
  { value: 'sonnet', label: 'Sonnet', icon: SparklesIcon, description: 'Balanced performance' },
  { value: 'haiku', label: 'Haiku', icon: ZapIcon, description: 'Fast and efficient' },
  { value: 'opus', label: 'Opus', icon: BrainIcon, description: 'Most capable' },
];

export function AgentsManager() {
  const { state, userAgents, projectAgents, loadAgents, createAgent, deleteAgent, getAgentDefinition } = useAgents();
  const { state: projectState } = useProjects();
  const { isLoading, error } = state;
  const currentProject = projectState.currentProject;

  const [isOpen, setIsOpen] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [viewDefinition, setViewDefinition] = useState<AgentDefinition | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(false);

  // Create form state
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState(DEFAULT_AGENT.description);
  const [agentPrompt, setAgentPrompt] = useState(DEFAULT_AGENT.prompt);
  const [agentTools, setAgentTools] = useState<string[]>([]);
  const [agentModel, setAgentModel] = useState<ModelAlias | 'inherit'>('inherit');
  const [agentScope, setAgentScope] = useState<AgentScope>("user");
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const resetForm = () => {
    setAgentName("");
    setAgentDescription(DEFAULT_AGENT.description);
    setAgentPrompt(DEFAULT_AGENT.prompt);
    setAgentTools([]);
    setAgentModel('inherit');
    setAgentScope("user");
  };

  const handleCreate = async () => {
    if (!agentName.trim() || !agentDescription.trim() || !agentPrompt.trim()) return;

    // Sanitize agent name for use as directory name
    const sanitizedName = agentName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!sanitizedName) return;

    setIsCreating(true);
    try {
      const definition: AgentDefinition = {
        description: agentDescription,
        prompt: agentPrompt,
      };

      // Only include tools if specified
      if (agentTools.length > 0) {
        definition.tools = agentTools;
      }

      // Only include model if not inheriting
      if (agentModel !== 'inherit') {
        definition.model = agentModel;
      }

      await createAgent(sanitizedName, definition, agentScope);
      setShowCreateDialog(false);
      resetForm();
    } catch (err) {
      // Error is handled in context
    } finally {
      setIsCreating(false);
    }
  };

  const handleViewAgent = async (agent: Agent) => {
    setSelectedAgent(agent);
    setIsLoadingContent(true);
    setShowViewDialog(true);

    const definition = await getAgentDefinition(agent.name, agent.scope, agent.projectId);
    setViewDefinition(definition);
    setIsLoadingContent(false);
  };

  const handleDeleteClick = (agent: Agent) => {
    setSelectedAgent(agent);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!selectedAgent) return;

    setIsDeleting(true);
    try {
      await deleteAgent(selectedAgent.name, selectedAgent.scope, selectedAgent.projectId);
      setShowDeleteDialog(false);
    } catch (err) {
      // Error handled in context
    } finally {
      setIsDeleting(false);
      setSelectedAgent(null);
    }
  };

  const toggleTool = (tool: string) => {
    setAgentTools(prev =>
      prev.includes(tool)
        ? prev.filter(t => t !== tool)
        : [...prev, tool]
    );
  };

  const renderAgentItem = (agent: Agent) => (
    <SidebarMenuItem key={`${agent.scope}-${agent.name}`} className="group/agent">
      <SidebarMenuButton
        className="flex items-center gap-2 pr-16"
        onClick={() => handleViewAgent(agent)}
      >
        <BotIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm">
          {agent.name}
        </span>
        {agent.scope === 'user' && (
          <span title="User agent (all projects)">
            <GlobeIcon className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
          </span>
        )}
        {agent.scope === 'project' && (
          <span title="Project agent">
            <FolderIcon className="h-3 w-3 text-blue-500 ml-auto shrink-0" />
          </span>
        )}
      </SidebarMenuButton>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/agent:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            handleViewAgent(agent);
          }}
          title="View agent"
        >
          <EyeIcon className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteClick(agent);
          }}
          title="Delete agent"
        >
          <TrashIcon className="h-3 w-3" />
        </Button>
      </div>
    </SidebarMenuItem>
  );

  const hasAgents = userAgents.length > 0 || projectAgents.length > 0;

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <SidebarGroup>
          <CollapsibleTrigger asChild>
            <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 rounded-md transition-colors flex items-center justify-between pr-2">
              <span className="flex items-center gap-2">
                <BotIcon className="h-4 w-4" />
                Agents
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={(e) => {
                    e.stopPropagation();
                    loadAgents();
                  }}
                  title="Refresh agents"
                >
                  <RefreshCwIcon className={cn("h-3 w-3", isLoading && "animate-spin")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCreateDialog(true);
                  }}
                  title="Add agent"
                >
                  <PlusIcon className="h-3 w-3" />
                </Button>
                {isOpen ? (
                  <ChevronDownIcon className="h-4 w-4" />
                ) : (
                  <ChevronRightIcon className="h-4 w-4" />
                )}
              </div>
            </SidebarGroupLabel>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <SidebarGroupContent>
              <SidebarMenu>
                {isLoading ? (
                  <>
                    {[1, 2].map((i) => (
                      <SidebarMenuItem key={i}>
                        <div className="flex items-center gap-2 p-2">
                          <Skeleton className="h-4 w-4" />
                          <Skeleton className="h-4 flex-1" />
                        </div>
                      </SidebarMenuItem>
                    ))}
                  </>
                ) : error ? (
                  <div className="px-4 py-2 text-xs text-destructive">
                    {error}
                  </div>
                ) : !hasAgents ? (
                  <div className="px-4 py-4 text-center text-sm text-muted-foreground">
                    <BotIcon className="mx-auto h-6 w-6 mb-2 opacity-50" />
                    <p className="text-xs">No agents yet</p>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setShowCreateDialog(true)}
                      className="mt-1 h-auto p-0 text-xs"
                    >
                      Add your first agent
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* User Agents Section */}
                    {userAgents.length > 0 && (
                      <>
                        <div className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <GlobeIcon className="h-3 w-3" />
                          All Projects
                        </div>
                        {userAgents.map(renderAgentItem)}
                      </>
                    )}

                    {/* Project Agents Section */}
                    {projectAgents.length > 0 && (
                      <>
                        <div className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center gap-1 mt-2">
                          <FolderIcon className="h-3 w-3" />
                          {currentProject?.name || 'Current Project'}
                        </div>
                        {projectAgents.map(renderAgentItem)}
                      </>
                    )}
                  </>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>

      {/* Create Agent Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="w-[95vw] sm:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BotIcon className="h-5 w-5" />
              Create New Agent
            </DialogTitle>
            <DialogDescription>
              Agents are autonomous sub-assistants that Claude can invoke for specialized tasks.
              Define when to use it, what tools it has, and its system prompt.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-4 px-1">
            {/* Name and Scope Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Agent Name</Label>
                <Input
                  id="agent-name"
                  placeholder="code-reviewer"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase with hyphens only
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="agent-scope">Scope</Label>
                <Select value={agentScope} onValueChange={(v) => setAgentScope(v as AgentScope)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">
                      <div className="flex items-center gap-2">
                        <GlobeIcon className="h-4 w-4" />
                        <span>All Projects</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="project" disabled={!currentProject}>
                      <div className="flex items-center gap-2">
                        <FolderIcon className="h-4 w-4" />
                        <span>{currentProject?.name || 'Current Project'}</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="agent-description">Trigger Description</Label>
              <Textarea
                id="agent-description"
                className="min-h-[100px] resize-y"
                placeholder="Use this agent when the user asks to review code for bugs, security issues, or best practices..."
                value={agentDescription}
                onChange={(e) => setAgentDescription(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Describes when Claude should invoke this agent. Be specific about trigger conditions.
              </p>
            </div>

            {/* Model Selection */}
            <div className="space-y-2">
              <Label>Model</Label>
              <div className="flex flex-wrap gap-2">
                {MODEL_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={agentModel === option.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setAgentModel(option.value)}
                      className="gap-1"
                    >
                      <Icon className="h-3 w-3" />
                      {option.label}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {MODEL_OPTIONS.find(o => o.value === agentModel)?.description}
              </p>
            </div>

            {/* Tools Selection */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <WrenchIcon className="h-4 w-4" />
                Allowed Tools
              </Label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_TOOLS.map((tool) => (
                  <Button
                    key={tool}
                    type="button"
                    variant={agentTools.includes(tool) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleTool(tool)}
                  >
                    {tool}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {agentTools.length === 0
                  ? "No tools selected - agent will inherit all tools from parent"
                  : `${agentTools.length} tool${agentTools.length !== 1 ? 's' : ''} selected`}
              </p>
            </div>

            {/* System Prompt */}
            <div className="space-y-2">
              <Label htmlFor="agent-prompt">System Prompt</Label>
              <Textarea
                id="agent-prompt"
                className="font-mono text-sm min-h-[300px] resize-y"
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The instructions that define the agent's behavior, expertise, and output format.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateDialog(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!agentName.trim() || !agentDescription.trim() || !agentPrompt.trim() || isCreating}
            >
              {isCreating ? "Creating..." : "Create Agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Agent Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="w-[95vw] sm:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BotIcon className="h-5 w-5" />
              {selectedAgent?.name}
              <Badge variant={selectedAgent?.scope === 'user' ? 'secondary' : 'default'} className="ml-2">
                {selectedAgent?.scope === 'user' ? (
                  <><GlobeIcon className="h-3 w-3 mr-1" /> All Projects</>
                ) : (
                  <><FolderIcon className="h-3 w-3 mr-1" /> Project</>
                )}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {selectedAgent?.scope === 'user'
                ? `users/agents/${selectedAgent?.name}/AGENT.md`
                : `projects/${currentProject?.name}/agents/${selectedAgent?.name}/AGENT.md`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-4 px-1 space-y-4">
            {isLoadingContent ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ) : viewDefinition ? (
              <>
                {/* Description */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Trigger Description</Label>
                  <p className="text-sm bg-muted p-3 rounded-lg">{viewDefinition.description}</p>
                </div>

                {/* Model */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Model</Label>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const model = viewDefinition.model || 'inherit';
                      const option = MODEL_OPTIONS.find(o => o.value === model);
                      const Icon = option?.icon || SparklesIcon;
                      return (
                        <Badge variant="outline" className="gap-1">
                          <Icon className="h-3 w-3" />
                          {option?.label || 'Inherit'}
                        </Badge>
                      );
                    })()}
                  </div>
                </div>

                {/* Tools */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Allowed Tools</Label>
                  <div className="flex flex-wrap gap-1">
                    {viewDefinition.tools && viewDefinition.tools.length > 0 ? (
                      viewDefinition.tools.map(tool => (
                        <Badge key={tool} variant="outline">{tool}</Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">All tools (inherited)</span>
                    )}
                  </div>
                </div>

                {/* System Prompt */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">System Prompt</Label>
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm whitespace-pre-wrap font-mono">
                    {viewDefinition.prompt}
                  </pre>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Failed to load agent definition</div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowViewDialog(false)}>
              Close
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowViewDialog(false);
                if (selectedAgent) {
                  handleDeleteClick(selectedAgent);
                }
              }}
            >
              <TrashIcon className="h-4 w-4 mr-2" />
              Delete Agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete Agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{selectedAgent?.name}"?
              {selectedAgent?.scope === 'user'
                ? ' This agent is available across all projects.'
                : ` This agent is only in ${currentProject?.name || 'the current project'}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

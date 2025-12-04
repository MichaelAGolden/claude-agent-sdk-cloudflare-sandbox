import { useState } from "react";
import {
  PlusIcon,
  TrashIcon,
  SparklesIcon,
  FileTextIcon,
  UploadIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  RefreshCwIcon,
  GlobeIcon,
  FolderIcon,
} from "lucide-react";
import { useSkills, type Skill, type SkillScope } from "@/contexts/SkillsContext";
import { useProjects } from "@/contexts/ProjectContext";
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

// Skill template for new skills (SKILL.md format)
const SKILL_TEMPLATE = `---
description: Use this skill when the user asks to [describe trigger conditions]
---

# Skill Name

## When to Use
This skill should be used when [describe scenarios].

## Instructions
1. [First instruction]
2. [Second instruction]
3. [Third instruction]

## Output Format
[Describe expected output format]
`;

export function SkillsManager() {
  const { state, userSkills, projectSkills, loadSkills, uploadSkill, deleteSkill, getSkillContent } = useSkills();
  const { state: projectState } = useProjects();
  const { isLoading, error } = state;
  const currentProject = projectState.currentProject;

  const [isOpen, setIsOpen] = useState(true);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [viewContent, setViewContent] = useState<string>("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);

  // Upload form state
  const [skillName, setSkillName] = useState("");
  const [skillContent, setSkillContent] = useState(SKILL_TEMPLATE);
  const [skillScope, setSkillScope] = useState<SkillScope>("user");
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showRefreshPrompt, setShowRefreshPrompt] = useState(false);

  const handleUpload = async () => {
    if (!skillName.trim() || !skillContent.trim()) return;

    // Sanitize skill name for use as directory name
    const sanitizedName = skillName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    setIsUploading(true);
    try {
      await uploadSkill(sanitizedName, skillContent, skillScope);
      setShowUploadDialog(false);
      setSkillName("");
      setSkillContent(SKILL_TEMPLATE);
      setSkillScope("user");
      // Agent restarts automatically - no need to show refresh prompt
    } catch (err) {
      // Error is handled in context
    } finally {
      setIsUploading(false);
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  const handleViewSkill = async (skill: Skill) => {
    setSelectedSkill(skill);
    setIsLoadingContent(true);
    setShowViewDialog(true);

    const content = await getSkillContent(skill.name, skill.scope, skill.projectId);
    setViewContent(content || "Failed to load skill content");
    setIsLoadingContent(false);
  };

  const handleDeleteClick = (skill: Skill) => {
    setSelectedSkill(skill);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!selectedSkill) return;

    setIsDeleting(true);
    try {
      await deleteSkill(selectedSkill.name, selectedSkill.scope, selectedSkill.projectId);
      setShowDeleteDialog(false);
    } catch (err) {
      // Error handled in context
    } finally {
      setIsDeleting(false);
      setSelectedSkill(null);
    }
  };

  const renderSkillItem = (skill: Skill) => (
    <SidebarMenuItem key={`${skill.scope}-${skill.name}`} className="group/skill">
      <SidebarMenuButton
        className="flex items-center gap-2 pr-16"
        onClick={() => handleViewSkill(skill)}
      >
        <FileTextIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm">
          {skill.name}
        </span>
        {skill.scope === 'user' && (
          <span title="User skill (all projects)">
            <GlobeIcon className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
          </span>
        )}
        {skill.scope === 'project' && (
          <span title="Project skill">
            <FolderIcon className="h-3 w-3 text-blue-500 ml-auto shrink-0" />
          </span>
        )}
      </SidebarMenuButton>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/skill:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            handleViewSkill(skill);
          }}
          title="View skill"
        >
          <EyeIcon className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteClick(skill);
          }}
          title="Delete skill"
        >
          <TrashIcon className="h-3 w-3" />
        </Button>
      </div>
    </SidebarMenuItem>
  );

  const hasSkills = userSkills.length > 0 || projectSkills.length > 0;

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <SidebarGroup>
          <CollapsibleTrigger asChild>
            <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 rounded-md transition-colors flex items-center justify-between pr-2">
              <span className="flex items-center gap-2">
                <SparklesIcon className="h-4 w-4" />
                Skills
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={(e) => {
                    e.stopPropagation();
                    loadSkills();
                  }}
                  title="Refresh skills"
                >
                  <RefreshCwIcon className={cn("h-3 w-3", isLoading && "animate-spin")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowUploadDialog(true);
                  }}
                  title="Add skill"
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
                ) : !hasSkills ? (
                  <div className="px-4 py-4 text-center text-sm text-muted-foreground">
                    <SparklesIcon className="mx-auto h-6 w-6 mb-2 opacity-50" />
                    <p className="text-xs">No skills yet</p>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setShowUploadDialog(true)}
                      className="mt-1 h-auto p-0 text-xs"
                    >
                      Add your first skill
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* User Skills Section */}
                    {userSkills.length > 0 && (
                      <>
                        <div className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <GlobeIcon className="h-3 w-3" />
                          All Projects
                        </div>
                        {userSkills.map(renderSkillItem)}
                      </>
                    )}

                    {/* Project Skills Section */}
                    {projectSkills.length > 0 && (
                      <>
                        <div className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center gap-1 mt-2">
                          <FolderIcon className="h-3 w-3" />
                          {currentProject?.name || 'Current Project'}
                        </div>
                        {projectSkills.map(renderSkillItem)}
                      </>
                    )}
                  </>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>

      {/* Upload Skill Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="w-[95vw] sm:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UploadIcon className="h-5 w-5" />
              Add New Skill
            </DialogTitle>
            <DialogDescription>
              Skills extend Claude with specialized capabilities. Create a skill
              with YAML frontmatter and markdown instructions.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-4 px-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="skill-name">Skill Name</Label>
                <Input
                  id="skill-name"
                  placeholder="my-skill"
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="skill-scope">Scope</Label>
                <Select value={skillScope} onValueChange={(v) => setSkillScope(v as SkillScope)}>
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

            <p className="text-xs text-muted-foreground">
              {skillScope === 'user' ? (
                <>Creates: users/skills/{skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "my-skill"}/SKILL.md (available in all projects)</>
              ) : (
                <>Creates: projects/{currentProject?.name}/skills/{skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "my-skill"}/SKILL.md (this project only)</>
              )}
            </p>

            <div className="space-y-2">
              <Label htmlFor="skill-content">SKILL.md Content</Label>
              <Textarea
                id="skill-content"
                className="font-mono text-sm min-h-[400px] resize-y"
                value={skillContent}
                onChange={(e) => setSkillContent(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Use YAML frontmatter with a description field. The description
                determines when Claude autonomously invokes this skill.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowUploadDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!skillName.trim() || !skillContent.trim() || isUploading}
            >
              {isUploading ? "Uploading..." : "Add Skill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Skill Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="w-[95vw] sm:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileTextIcon className="h-5 w-5" />
              {selectedSkill?.name}
              <Badge variant={selectedSkill?.scope === 'user' ? 'secondary' : 'default'} className="ml-2">
                {selectedSkill?.scope === 'user' ? (
                  <><GlobeIcon className="h-3 w-3 mr-1" /> All Projects</>
                ) : (
                  <><FolderIcon className="h-3 w-3 mr-1" /> Project</>
                )}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {selectedSkill?.scope === 'user'
                ? `users/skills/${selectedSkill?.name}/SKILL.md`
                : `projects/${currentProject?.name}/skills/${selectedSkill?.name}/SKILL.md`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-4 px-1">
            {isLoadingContent ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ) : (
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm whitespace-pre-wrap font-mono">
                {viewContent}
              </pre>
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
                if (selectedSkill) {
                  handleDeleteClick(selectedSkill);
                }
              }}
            >
              <TrashIcon className="h-4 w-4 mr-2" />
              Delete Skill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete Skill</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{selectedSkill?.name}"?
              {selectedSkill?.scope === 'user'
                ? ' This skill is available across all projects.'
                : ` This skill is only in ${currentProject?.name || 'the current project'}.`}
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

      {/* Refresh Prompt Dialog */}
      <Dialog open={showRefreshPrompt} onOpenChange={setShowRefreshPrompt}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SparklesIcon className="h-5 w-5 text-green-500" />
              Skill Added Successfully
            </DialogTitle>
            <DialogDescription>
              Your skill has been saved. To use it in your conversation, you need
              to refresh the page so the agent can load the new skill.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRefreshPrompt(false)}>
              Later
            </Button>
            <Button onClick={handleRefresh}>
              <RefreshCwIcon className="h-4 w-4 mr-2" />
              Refresh Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

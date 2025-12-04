import { useState } from 'react';
import { useProjects, type Project } from '@/contexts/ProjectContext';
import { useThreads } from '@/contexts/ThreadContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  FolderOpen,
  ChevronDown,
  Plus,
  Settings,
  Check,
  Loader2,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function ProjectSelector() {
  const { state, createProject, switchProject, updateProject, deleteProject } = useProjects();
  const { setCurrentProjectId } = useThreads();
  const { projects, currentProject, isSwitching } = state;

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    setIsCreating(true);
    const project = await createProject(newProjectName.trim(), newProjectDescription.trim() || undefined);
    setIsCreating(false);

    if (project) {
      setIsCreateDialogOpen(false);
      setNewProjectName('');
      setNewProjectDescription('');
      // Automatically switch to the new project
      await switchProject(project.id);
      setCurrentProjectId(project.id);
    }
  };

  const handleSwitchProject = async (project: Project) => {
    if (project.id === currentProject?.id) return;

    const success = await switchProject(project.id);
    if (success) {
      setCurrentProjectId(project.id);
    }
  };

  const handleEditProject = (project: Project) => {
    setEditingProject(project);
    setNewProjectName(project.name);
    setNewProjectDescription(project.description || '');
    setIsEditDialogOpen(true);
  };

  const handleSaveProject = async () => {
    if (!editingProject || !newProjectName.trim()) return;

    setIsSaving(true);
    await updateProject(editingProject.id, {
      name: newProjectName.trim(),
      description: newProjectDescription.trim() || undefined,
    });
    setIsSaving(false);
    setIsEditDialogOpen(false);
    setEditingProject(null);
  };

  const handleDeleteProject = async (project: Project) => {
    if (project.is_default) return;

    const confirmed = window.confirm(`Are you sure you want to delete "${project.name}"? This action cannot be undone.`);
    if (confirmed) {
      await deleteProject(project.id);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 gap-2 px-2 text-sm font-medium"
            disabled={isSwitching}
          >
            {isSwitching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen className="h-4 w-4" />
            )}
            <span className="max-w-[150px] truncate">
              {currentProject?.name || 'Select Project'}
            </span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[240px]">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Projects
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {projects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              className={cn(
                "flex items-center gap-2 cursor-pointer",
                project.id === currentProject?.id && "bg-accent"
              )}
              onClick={() => handleSwitchProject(project)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate">{project.name}</span>
                  {project.is_default === 1 && (
                    <span className="text-[10px] px-1 py-0.5 bg-muted rounded text-muted-foreground">
                      Default
                    </span>
                  )}
                </div>
                {project.description && (
                  <p className="text-xs text-muted-foreground truncate">
                    {project.description}
                  </p>
                )}
              </div>
              {project.id === currentProject?.id && (
                <Check className="h-4 w-4 text-primary shrink-0" />
              )}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            <span>New Project</span>
          </DropdownMenuItem>

          {currentProject && !currentProject.is_default && (
            <DropdownMenuItem
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => handleEditProject(currentProject)}
            >
              <Settings className="h-4 w-4" />
              <span>Edit Current Project</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create Project Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Create a new workspace for your conversations. Each project has its own isolated file system.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                placeholder="My Project"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-description">Description (optional)</Label>
              <Textarea
                id="project-description"
                placeholder="A brief description of this project..."
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateProject}
              disabled={!newProjectName.trim() || isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Project'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update the project name and description.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-project-name">Name</Label>
              <Input
                id="edit-project-name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveProject()}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-project-description">Description</Label>
              <Textarea
                id="edit-project-description"
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="flex justify-between">
            <Button
              variant="destructive"
              onClick={() => editingProject && handleDeleteProject(editingProject)}
              disabled={editingProject?.is_default === 1}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsEditDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveProject}
                disabled={!newProjectName.trim() || isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

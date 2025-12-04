import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@clerk/clerk-react';

// API base URL - empty string means same origin
const API_BASE = '';

/**
 * Helper to create authenticated fetch with Clerk JWT
 */
const createAuthFetch = (getToken: () => Promise<string | null>) => {
  return async (path: string, options: RequestInit = {}): Promise<Response> => {
    const token = await getToken();
    const headers = new Headers(options.headers);

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    return fetch(`${API_BASE}${path}`, { ...options, headers });
  };
};

// ============================================================================
// TYPES
// ============================================================================

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_default: number; // SQLite boolean (0 or 1)
  created_at: string;
  updated_at: string;
}

interface WorkspaceSyncResult {
  filesSaved?: number;
  filesSkipped?: number;
  bytesSaved?: number;
  filesRestored?: number;
  bytesRestored?: number;
  errors?: string[];
}

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  isLoading: boolean;
  isSwitching: boolean;
  error: string | null;
}

interface ProjectContextType {
  state: ProjectState;
  createProject: (name: string, description?: string) => Promise<Project | null>;
  switchProject: (projectId: string) => Promise<boolean>;
  updateProject: (projectId: string, updates: { name?: string; description?: string }) => Promise<void>;
  deleteProject: (projectId: string) => Promise<boolean>;
  saveWorkspace: (projectId: string) => Promise<WorkspaceSyncResult | null>;
  refreshProjects: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { userId, isLoaded: isAuthLoaded, getToken } = useAuth();

  const [state, setState] = useState<ProjectState>({
    projects: [],
    currentProject: null,
    isLoading: false,
    isSwitching: false,
    error: null,
  });

  // Create authenticated fetch function
  const authFetch = useCallback(
    (path: string, options?: RequestInit) => createAuthFetch(getToken)(path, options),
    [getToken]
  );

  // Fetch all projects
  const refreshProjects = useCallback(async () => {
    if (!userId) return;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await authFetch('/api/projects');
      if (!response.ok) {
        throw new Error('Failed to fetch projects');
      }

      const data = await response.json();
      const projects: Project[] = data.projects || [];

      setState(prev => {
        // If no current project, select the default one
        let currentProject = prev.currentProject;
        if (!currentProject && projects.length > 0) {
          currentProject = projects.find(p => p.is_default === 1) || projects[0];
        }
        // Update current project if it exists in the new list
        if (currentProject) {
          currentProject = projects.find(p => p.id === currentProject!.id) || currentProject;
        }

        return {
          ...prev,
          projects,
          currentProject,
          isLoading: false,
        };
      });
    } catch (error: any) {
      console.error('[ProjectContext] Failed to fetch projects:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }));
    }
  }, [userId, authFetch]);

  // Create a new project
  const createProject = useCallback(async (name: string, description?: string): Promise<Project | null> => {
    if (!userId) return null;

    try {
      const response = await authFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create project');
      }

      const project: Project = await response.json();

      setState(prev => ({
        ...prev,
        projects: [project, ...prev.projects],
      }));

      return project;
    } catch (error: any) {
      console.error('[ProjectContext] Failed to create project:', error);
      setState(prev => ({ ...prev, error: error.message }));
      return null;
    }
  }, [userId, authFetch]);

  // Switch to a different project
  const switchProject = useCallback(async (projectId: string): Promise<boolean> => {
    if (!userId) return false;

    const fromProjectId = state.currentProject?.id;
    if (fromProjectId === projectId) return true; // Already on this project

    setState(prev => ({ ...prev, isSwitching: true, error: null }));

    try {
      const response = await authFetch(`/api/projects/${projectId}/switch`, {
        method: 'POST',
        body: JSON.stringify({ fromProjectId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to switch project');
      }

      const data = await response.json();
      const project: Project = data.project;

      console.log('[ProjectContext] Switched to project:', project.name);
      console.log('[ProjectContext] Workspace sync:', data.workspace);

      setState(prev => ({
        ...prev,
        currentProject: project,
        isSwitching: false,
      }));

      // Dispatch event for other contexts to react (e.g., ThreadContext, FileExplorer)
      window.dispatchEvent(new CustomEvent('project-switched', { detail: { projectId } }));

      return true;
    } catch (error: any) {
      console.error('[ProjectContext] Failed to switch project:', error);
      setState(prev => ({
        ...prev,
        isSwitching: false,
        error: error.message,
      }));
      return false;
    }
  }, [userId, state.currentProject?.id, authFetch]);

  // Update a project
  const updateProject = useCallback(async (
    projectId: string,
    updates: { name?: string; description?: string }
  ): Promise<void> => {
    try {
      const response = await authFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update project');
      }

      const updatedProject: Project = await response.json();

      setState(prev => ({
        ...prev,
        projects: prev.projects.map(p => p.id === projectId ? updatedProject : p),
        currentProject: prev.currentProject?.id === projectId ? updatedProject : prev.currentProject,
      }));
    } catch (error: any) {
      console.error('[ProjectContext] Failed to update project:', error);
      setState(prev => ({ ...prev, error: error.message }));
    }
  }, [authFetch]);

  // Delete a project
  const deleteProject = useCallback(async (projectId: string): Promise<boolean> => {
    try {
      const response = await authFetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete project');
      }

      setState(prev => {
        const projects = prev.projects.filter(p => p.id !== projectId);
        const wasCurrentProject = prev.currentProject?.id === projectId;

        return {
          ...prev,
          projects,
          // If we deleted the current project, switch to default
          currentProject: wasCurrentProject
            ? (projects.find(p => p.is_default === 1) || projects[0] || null)
            : prev.currentProject,
        };
      });

      return true;
    } catch (error: any) {
      console.error('[ProjectContext] Failed to delete project:', error);
      setState(prev => ({ ...prev, error: error.message }));
      return false;
    }
  }, [authFetch]);

  // Manually save workspace to R2
  const saveWorkspace = useCallback(async (projectId: string): Promise<WorkspaceSyncResult | null> => {
    try {
      const response = await authFetch(`/api/projects/${projectId}/save-workspace`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save workspace');
      }

      const result = await response.json();
      console.log('[ProjectContext] Workspace saved:', result);
      return result;
    } catch (error: any) {
      console.error('[ProjectContext] Failed to save workspace:', error);
      return null;
    }
  }, [authFetch]);

  // Fetch projects when user is authenticated
  useEffect(() => {
    if (isAuthLoaded && userId) {
      refreshProjects();
    }
  }, [isAuthLoaded, userId, refreshProjects]);

  // Notify ThreadContext when initial project is loaded
  useEffect(() => {
    if (state.currentProject && !state.isLoading) {
      // Dispatch event so ThreadContext can filter threads by project
      window.dispatchEvent(new CustomEvent('project-switched', {
        detail: { projectId: state.currentProject.id }
      }));
    }
  }, [state.currentProject?.id, state.isLoading]);

  // Save workspace periodically
  // Note: Page unload sync is handled by AgentContext's file sync service
  // which triggers fullSyncFiles on disconnect. We don't use sendBeacon here
  // because it cannot include auth headers.
  useEffect(() => {
    if (!state.currentProject) return;

    // Periodic save every 5 minutes
    const interval = setInterval(() => {
      if (state.currentProject) {
        saveWorkspace(state.currentProject.id);
      }
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(interval);
    };
  }, [state.currentProject, saveWorkspace]);

  return (
    <ProjectContext.Provider
      value={{
        state,
        createProject,
        switchProject,
        updateProject,
        deleteProject,
        saveWorkspace,
        refreshProjects,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

export function useProjects() {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useProjects must be used within a ProjectProvider');
  }
  return ctx;
}

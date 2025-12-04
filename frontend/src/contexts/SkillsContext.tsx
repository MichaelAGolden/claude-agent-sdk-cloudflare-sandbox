import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useProjects } from './ProjectContext';

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

export type SkillScope = 'user' | 'project';

export interface Skill {
  name: string;
  scope: SkillScope;
  projectId?: string;
  content?: string;
  description?: string;
  uploadedAt?: string;
  size?: number;
}

interface SkillsState {
  skills: Skill[];
  isLoading: boolean;
  error: string | null;
  selectedSkill: Skill | null;
}

type SkillsAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_SKILLS'; payload: Skill[] }
  | { type: 'ADD_SKILL'; payload: Skill }
  | { type: 'REMOVE_SKILL'; payload: { name: string; scope: SkillScope; projectId?: string } }
  | { type: 'SET_SELECTED_SKILL'; payload: Skill | null };

const initialState: SkillsState = {
  skills: [],
  isLoading: false,
  error: null,
  selectedSkill: null,
};

function skillsReducer(state: SkillsState, action: SkillsAction): SkillsState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_SKILLS':
      return { ...state, skills: action.payload };
    case 'ADD_SKILL':
      return { ...state, skills: [...state.skills, action.payload] };
    case 'REMOVE_SKILL':
      return {
        ...state,
        skills: state.skills.filter(s =>
          !(s.name === action.payload.name &&
            s.scope === action.payload.scope &&
            s.projectId === action.payload.projectId)
        )
      };
    case 'SET_SELECTED_SKILL':
      return { ...state, selectedSkill: action.payload };
    default:
      return state;
  }
}

interface SkillsContextValue {
  state: SkillsState;
  userSkills: Skill[];
  projectSkills: Skill[];
  loadSkills: () => Promise<void>;
  uploadSkill: (name: string, content: string, scope?: SkillScope) => Promise<void>;
  deleteSkill: (name: string, scope: SkillScope, projectId?: string) => Promise<void>;
  getSkillContent: (name: string, scope?: SkillScope, projectId?: string) => Promise<string | null>;
  selectSkill: (skill: Skill | null) => void;
}

const SkillsContext = createContext<SkillsContextValue | null>(null);

export function SkillsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(skillsReducer, initialState);
  const { userId, isLoaded: isAuthLoaded, getToken } = useAuth();
  const { state: projectState } = useProjects();
  const currentProjectId = projectState.currentProject?.id;

  // Create authenticated fetch function
  const authFetch = useCallback(
    (path: string, options?: RequestInit) => createAuthFetch(getToken)(path, options),
    [getToken]
  );

  // Computed: filter skills by scope
  const userSkills = state.skills.filter(s => s.scope === 'user');
  const projectSkills = state.skills.filter(s => s.scope === 'project');

  const loadSkills = useCallback(async () => {
    if (!userId) return;

    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      // Include projectId to get both user and project skills
      const url = currentProjectId
        ? `/api/skills?projectId=${encodeURIComponent(currentProjectId)}`
        : '/api/skills';

      const response = await authFetch(url);
      if (!response.ok) {
        throw new Error('Failed to load skills');
      }
      const data = await response.json();
      // API now returns full skill objects with scope info
      const skills: Skill[] = data.skills || [];
      dispatch({ type: 'SET_SKILLS', payload: skills });
    } catch (error: any) {
      console.error('[Skills] Load error:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [userId, currentProjectId, authFetch]);

  const uploadSkill = useCallback(async (name: string, content: string, scope: SkillScope = 'user') => {
    if (!userId) return;

    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      const body: { name: string; content: string; projectId?: string } = { name, content };

      // If project scope, include the current project ID
      if (scope === 'project' && currentProjectId) {
        body.projectId = currentProjectId;
      }

      const response = await authFetch('/api/skills', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload skill');
      }

      // Refresh skills list
      await loadSkills();
    } catch (error: any) {
      console.error('[Skills] Upload error:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
      throw error;
    }
  }, [userId, currentProjectId, authFetch, loadSkills]);

  const deleteSkill = useCallback(async (name: string, scope: SkillScope, projectId?: string) => {
    if (!userId) return;

    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      // Build URL with query params for scope specificity
      let url = `/api/skills/${encodeURIComponent(name)}?scope=${scope}`;
      if (scope === 'project' && (projectId || currentProjectId)) {
        url += `&projectId=${encodeURIComponent(projectId || currentProjectId!)}`;
      }

      const response = await authFetch(url, { method: 'DELETE' });

      if (!response.ok) {
        throw new Error('Failed to delete skill');
      }

      dispatch({
        type: 'REMOVE_SKILL',
        payload: { name, scope, projectId: scope === 'project' ? (projectId || currentProjectId) : undefined }
      });

      // Clear selected if it was the deleted one
      if (state.selectedSkill?.name === name && state.selectedSkill?.scope === scope) {
        dispatch({ type: 'SET_SELECTED_SKILL', payload: null });
      }
    } catch (error: any) {
      console.error('[Skills] Delete error:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
      throw error;
    }
  }, [userId, currentProjectId, authFetch, state.selectedSkill]);

  const getSkillContent = useCallback(async (
    name: string,
    _scope?: SkillScope,
    projectId?: string
  ): Promise<string | null> => {
    if (!userId) return null;

    try {
      let url = `/api/skills/${encodeURIComponent(name)}`;
      if (projectId || currentProjectId) {
        url += `?projectId=${encodeURIComponent(projectId || currentProjectId!)}`;
      }

      const response = await authFetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      return data.content || null;
    } catch (error) {
      console.error('[Skills] Get content error:', error);
      return null;
    }
  }, [userId, currentProjectId, authFetch]);

  const selectSkill = useCallback((skill: Skill | null) => {
    dispatch({ type: 'SET_SELECTED_SKILL', payload: skill });
  }, []);

  // Load skills when auth is ready or project changes
  useEffect(() => {
    if (isAuthLoaded && userId) {
      loadSkills();
    }
  }, [isAuthLoaded, userId, currentProjectId, loadSkills]);

  // Listen for project switch events to reload skills
  useEffect(() => {
    const handleProjectSwitch = () => {
      if (isAuthLoaded && userId) {
        loadSkills();
      }
    };

    window.addEventListener('project-switched', handleProjectSwitch);
    return () => {
      window.removeEventListener('project-switched', handleProjectSwitch);
    };
  }, [isAuthLoaded, userId, loadSkills]);

  return (
    <SkillsContext.Provider value={{
      state,
      userSkills,
      projectSkills,
      loadSkills,
      uploadSkill,
      deleteSkill,
      getSkillContent,
      selectSkill,
    }}>
      {children}
    </SkillsContext.Provider>
  );
}

export function useSkills() {
  const context = useContext(SkillsContext);
  if (!context) {
    throw new Error('useSkills must be used within a SkillsProvider');
  }
  return context;
}

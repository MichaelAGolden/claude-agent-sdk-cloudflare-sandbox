import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useProjects } from './ProjectContext';
import type { AgentDefinition } from '../types';

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

export type AgentScope = 'user' | 'project';

export interface Agent {
  name: string;
  scope: AgentScope;
  projectId?: string;
  definition?: AgentDefinition;
  uploadedAt?: string;
  size?: number;
}

interface AgentsState {
  agents: Agent[];
  isLoading: boolean;
  error: string | null;
  selectedAgent: Agent | null;
}

type AgentsAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_AGENTS'; payload: Agent[] }
  | { type: 'ADD_AGENT'; payload: Agent }
  | { type: 'REMOVE_AGENT'; payload: { name: string; scope: AgentScope; projectId?: string } }
  | { type: 'SET_SELECTED_AGENT'; payload: Agent | null };

const initialState: AgentsState = {
  agents: [],
  isLoading: false,
  error: null,
  selectedAgent: null,
};

function agentsReducer(state: AgentsState, action: AgentsAction): AgentsState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_AGENTS':
      return { ...state, agents: action.payload };
    case 'ADD_AGENT':
      return { ...state, agents: [...state.agents, action.payload] };
    case 'REMOVE_AGENT':
      return {
        ...state,
        agents: state.agents.filter(a =>
          !(a.name === action.payload.name &&
            a.scope === action.payload.scope &&
            a.projectId === action.payload.projectId)
        )
      };
    case 'SET_SELECTED_AGENT':
      return { ...state, selectedAgent: action.payload };
    default:
      return state;
  }
}

interface AgentsContextValue {
  state: AgentsState;
  userAgents: Agent[];
  projectAgents: Agent[];
  loadAgents: () => Promise<void>;
  createAgent: (name: string, definition: AgentDefinition, scope?: AgentScope) => Promise<void>;
  deleteAgent: (name: string, scope: AgentScope, projectId?: string) => Promise<void>;
  getAgentDefinition: (name: string, scope?: AgentScope, projectId?: string) => Promise<AgentDefinition | null>;
  selectAgent: (agent: Agent | null) => void;
}

const AgentsContext = createContext<AgentsContextValue | null>(null);

export function AgentsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(agentsReducer, initialState);
  const { userId, isLoaded: isAuthLoaded, getToken } = useAuth();
  const { state: projectState } = useProjects();
  const currentProjectId = projectState.currentProject?.id;

  // Create authenticated fetch function
  const authFetch = useCallback(
    (path: string, options?: RequestInit) => createAuthFetch(getToken)(path, options),
    [getToken]
  );

  // Computed: filter agents by scope
  const userAgents = state.agents.filter(a => a.scope === 'user');
  const projectAgents = state.agents.filter(a => a.scope === 'project');

  const loadAgents = useCallback(async () => {
    if (!userId) return;

    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      // Include projectId to get both user and project agents
      const url = currentProjectId
        ? `/api/agents?projectId=${encodeURIComponent(currentProjectId)}`
        : '/api/agents';

      const response = await authFetch(url);
      if (!response.ok) {
        throw new Error('Failed to load agents');
      }
      const data = await response.json();
      // API returns agent info objects with scope info
      const agents: Agent[] = data.agents || [];
      dispatch({ type: 'SET_AGENTS', payload: agents });
    } catch (error: any) {
      console.error('[Agents] Load error:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [userId, currentProjectId, authFetch]);

  const createAgent = useCallback(async (name: string, definition: AgentDefinition, scope: AgentScope = 'user') => {
    if (!userId) return;

    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      const body: { name: string; definition: AgentDefinition; projectId?: string } = { name, definition };

      // If project scope, include the current project ID
      if (scope === 'project' && currentProjectId) {
        body.projectId = currentProjectId;
      }

      const response = await authFetch('/api/agents', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create agent');
      }

      // Refresh agents list
      await loadAgents();
    } catch (error: any) {
      console.error('[Agents] Create error:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
      throw error;
    }
  }, [userId, currentProjectId, authFetch, loadAgents]);

  const deleteAgent = useCallback(async (name: string, scope: AgentScope, projectId?: string) => {
    if (!userId) return;

    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      // Build URL with query params for scope specificity
      let url = `/api/agents/${encodeURIComponent(name)}?scope=${scope}`;
      if (scope === 'project' && (projectId || currentProjectId)) {
        url += `&projectId=${encodeURIComponent(projectId || currentProjectId!)}`;
      }

      const response = await authFetch(url, { method: 'DELETE' });

      if (!response.ok) {
        throw new Error('Failed to delete agent');
      }

      dispatch({
        type: 'REMOVE_AGENT',
        payload: { name, scope, projectId: scope === 'project' ? (projectId || currentProjectId) : undefined }
      });

      // Clear selected if it was the deleted one
      if (state.selectedAgent?.name === name && state.selectedAgent?.scope === scope) {
        dispatch({ type: 'SET_SELECTED_AGENT', payload: null });
      }
    } catch (error: any) {
      console.error('[Agents] Delete error:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
      throw error;
    }
  }, [userId, currentProjectId, authFetch, state.selectedAgent]);

  const getAgentDefinition = useCallback(async (
    name: string,
    _scope?: AgentScope,
    projectId?: string
  ): Promise<AgentDefinition | null> => {
    if (!userId) return null;

    try {
      let url = `/api/agents/${encodeURIComponent(name)}`;
      if (projectId || currentProjectId) {
        url += `?projectId=${encodeURIComponent(projectId || currentProjectId!)}`;
      }

      const response = await authFetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      return data.definition || null;
    } catch (error) {
      console.error('[Agents] Get definition error:', error);
      return null;
    }
  }, [userId, currentProjectId, authFetch]);

  const selectAgent = useCallback((agent: Agent | null) => {
    dispatch({ type: 'SET_SELECTED_AGENT', payload: agent });
  }, []);

  // Load agents when auth is ready or project changes
  useEffect(() => {
    if (isAuthLoaded && userId) {
      loadAgents();
    }
  }, [isAuthLoaded, userId, currentProjectId, loadAgents]);

  // Listen for project switch events to reload agents
  useEffect(() => {
    const handleProjectSwitch = () => {
      if (isAuthLoaded && userId) {
        loadAgents();
      }
    };

    window.addEventListener('project-switched', handleProjectSwitch);
    return () => {
      window.removeEventListener('project-switched', handleProjectSwitch);
    };
  }, [isAuthLoaded, userId, loadAgents]);

  return (
    <AgentsContext.Provider value={{
      state,
      userAgents,
      projectAgents,
      loadAgents,
      createAgent,
      deleteAgent,
      getAgentDefinition,
      selectAgent,
    }}>
      {children}
    </AgentsContext.Provider>
  );
}

export function useAgents() {
  const context = useContext(AgentsContext);
  if (!context) {
    throw new Error('useAgents must be used within an AgentsProvider');
  }
  return context;
}

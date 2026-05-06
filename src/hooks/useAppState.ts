import { useState, useEffect } from 'react';
import { flowDb } from '../storage/flow-db';
import type { OperationSession, OperationFlow } from '../types';

export function useAppState() {
  const [sessions, setSessions] = useState<OperationSession[]>([]);
  const [flows, setFlows] = useState<OperationFlow[]>([]);
  const [selectedFlow, setSelectedFlow] = useState<OperationFlow | null>(null);
  const [generatedCode, setGeneratedCode] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('https://api.openai.com/v1');
  const [apiModel, setApiModel] = useState('gpt-4o-mini');
  const [executeQuery, setExecuteQuery] = useState('');
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [taskDescription, setTaskDescription] = useState('');
  const [targetDomain, setTargetDomain] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<{
    currentStep: number;
    totalSteps: number;
    status: string;
  } | null>(null);
  const [isMining, setIsMining] = useState(false);
  const [miningProgress, setMiningProgress] = useState<{
    totalOps: number;
    filteredCount: number;
    sessionCount: number;
    flowCount: number;
    currentStep: string;
  } | null>(null);

  // 初始化
  useEffect(() => {
    initApp();
  }, []);

  // 将 flows 暴露到 window 供控制台调试
  useEffect(() => {
    (window as any).flows = flows;
  }, [flows]);

  const initApp = async () => {
    try {
      await flowDb.init();
      await loadData();
      
      const savedKey = await flowDb.getSetting('openai_api_key');
      if (savedKey) setApiKey(savedKey);
      
      const savedBaseUrl = await flowDb.getSetting('openai_base_url');
      if (savedBaseUrl) setApiBaseUrl(savedBaseUrl);
      
      const savedModel = await flowDb.getSetting('openai_model');
      if (savedModel) setApiModel(savedModel);
    } catch (error) {
      console.error('Init failed:', error);
    }
  };

  const loadData = async () => {
    const [sessionsData, flowsData] = await Promise.all([
      flowDb.getAllSessions(),
      flowDb.getAllFlows(),
    ]);
    setSessions(sessionsData);
    setFlows(flowsData);
  };

  return {
    sessions,
    flows,
    selectedFlow,
    generatedCode,
    apiKey,
    apiBaseUrl,
    apiModel,
    executeQuery,
    executionResult,
    taskDescription,
    targetDomain,
    isExecuting,
    executionProgress,
    isMining,
    miningProgress,
    
    setSessions,
    setFlows,
    setSelectedFlow,
    setGeneratedCode,
    setApiKey,
    setApiBaseUrl,
    setApiModel,
    setExecuteQuery,
    setExecutionResult,
    setTaskDescription,
    setTargetDomain,
    setIsExecuting,
    setExecutionProgress,
    setIsMining,
    setMiningProgress,
    
    loadData,
  };
}

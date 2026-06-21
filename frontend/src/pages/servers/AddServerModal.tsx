// Extracted from Servers.tsx - AddServerModal component
import React, { memo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { validateForm, addServerSchema } from '../../validations';
import { encodeUrlParam } from '../../utils/security';
import type { ProviderType } from '../Servers';
import { PROVIDER_CONFIG } from '../Servers';
import { addServer } from '../../api';
import { Wifi, CheckCircle, XCircle } from 'lucide-react';
import { toastSuccess, toastError } from '../../utils/toast';

interface AddServerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddServerModal = memo(function AddServerModal({
  isOpen,
  onClose,
}: AddServerModalProps) {
  const [newServerUrl, setNewServerUrl] = useState('');
  const [newServerConcurrency, setNewServerConcurrency] = useState<number | ''>('');
  const [newServerApiKey, setNewServerApiKey] = useState('');
  const [apiKeyConfirmed, setApiKeyConfirmed] = useState(false);
  const [newServerType, setNewServerType] = useState<'ollama' | 'openai' | 'auto'>('auto');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [newServerV1Models, setNewServerV1Models] = useState('');
  const [newServerForceOllama, setNewServerForceOllama] = useState(false);
  const [newServerForceV1, setNewServerForceV1] = useState(false);
  const [newServerForceAnthropic, setNewServerForceAnthropic] = useState(false);
  const [newServerAnthropicPathOverride, setNewServerAnthropicPathOverride] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>('ollama');
  const [testConnectionStatus, setTestConnectionStatus] = useState<
    'idle' | 'testing' | 'success' | 'error'
  >('idle');
  const [testConnectionMessage, setTestConnectionMessage] = useState('');

  const addMutation = useMutation({
    mutationFn: addServer,
    onSuccess: () => {
      toastSuccess('Server added successfully');
      handleClose();
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to add server');
    },
  });

  const handleClose = () => {
    onClose();
    setNewServerUrl('');
    setNewServerConcurrency('');
    setNewServerApiKey('');
    setApiKeyConfirmed(false);
    setNewServerType('ollama');
    setShowAdvancedOptions(false);
    setNewServerV1Models('');
    setNewServerForceOllama(false);
    setNewServerForceV1(false);
    setNewServerForceAnthropic(false);
    setNewServerAnthropicPathOverride('');
    setValidationErrors({});
  };

  const handleAddServer = (e: React.FormEvent) => {
    e.preventDefault();

    const formData = {
      url: newServerUrl,
      maxConcurrency: newServerConcurrency === '' ? undefined : newServerConcurrency,
      apiKey: newServerApiKey || undefined,
      v1Models: newServerV1Models || undefined,
      forceOllama: newServerForceOllama || undefined,
      forceV1: newServerForceV1 || undefined,
      forceAnthropic: newServerForceAnthropic || undefined,
      anthropicPathOverride: newServerAnthropicPathOverride || undefined,
    };

    const validation = validateForm(addServerSchema, formData);

    if (!validation.success) {
      setValidationErrors(validation.errors || {});
      return;
    }

    setValidationErrors({});

    const id = btoa(encodeUrlParam(newServerUrl)).replace(/[^a-zA-Z0-9]/g, '');
    addMutation.mutate({
      id,
      url: newServerUrl,
      type: newServerType,
      maxConcurrency: newServerConcurrency === '' ? undefined : newServerConcurrency,
      apiKey: newServerApiKey || undefined,
      v1Models: newServerV1Models || undefined,
      forceOllama: newServerForceOllama || undefined,
      forceV1: newServerForceV1 || undefined,
      forceAnthropic: newServerForceAnthropic || undefined,
      anthropicPathOverride: newServerAnthropicPathOverride || undefined,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add New Server">
      <form onSubmit={handleAddServer} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Provider</label>
          <select
            value={selectedProvider}
            onChange={e => {
              const provider = e.target.value as ProviderType;
              setSelectedProvider(provider);
              if (provider !== 'custom') {
                setNewServerUrl(PROVIDER_CONFIG[provider].baseUrl);
              }
            }}
            className="w-full bg-surface-raised border border-surface-border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500"
          >
            <option value="ollama">Ollama</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="azure">Azure OpenAI</option>
            <option value="bedrock">AWS Bedrock</option>
            <option value="minimax">MiniMax</option>
            <option value="custom">Custom</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">{PROVIDER_CONFIG[selectedProvider].hint}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Server URL</label>
          <input
            type="text"
            value={newServerUrl}
            onChange={e => setNewServerUrl(e.target.value)}
            placeholder="http://localhost:11434"
            className={`w-full bg-surface-raised border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500 ${
              validationErrors.url ? 'border-red-500' : 'border-surface-border'
            }`}
          />
          {validationErrors.url && (
            <p className="mt-1 text-sm text-red-400">{validationErrors.url}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Server Type</label>
          <select
            value={newServerType}
            onChange={e => setNewServerType(e.target.value as 'ollama' | 'openai' | 'auto')}
            className="w-full bg-surface-raised border border-surface-border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500"
          >
            <option value="ollama">Ollama</option>
            <option value="openai">OpenAI-compatible</option>
            <option value="auto">Auto-detect</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Auto-detect probes both Ollama and OpenAI endpoints
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Max Concurrency (optional)
          </label>
          <input
            type="number"
            value={newServerConcurrency}
            onChange={e =>
              setNewServerConcurrency(e.target.value === '' ? '' : parseInt(e.target.value))
            }
            placeholder="4"
            min="1"
            max="100"
            className={`w-full bg-surface-raised border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500 ${
              validationErrors.maxConcurrency ? 'border-red-500' : 'border-surface-border'
            }`}
          />
          {validationErrors.maxConcurrency && (
            <p className="mt-1 text-sm text-red-400">{validationErrors.maxConcurrency}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">API Key (optional)</label>
          <input
            type="password"
            value={newServerApiKey}
            onChange={e => setNewServerApiKey(e.target.value)}
            placeholder="env:MY_API_KEY or sk-..."
            className={`w-full bg-surface-raised border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500 ${
              validationErrors.apiKey ? 'border-red-500' : 'border-surface-border'
            }`}
          />
          {validationErrors.apiKey && (
            <p className="mt-1 text-sm text-red-400">{validationErrors.apiKey}</p>
          )}
          {newServerApiKey && !newServerApiKey.startsWith('env:') && (
            <>
              <p className="mt-1 text-sm text-yellow-400">
                Warning: Plain text API keys are stored unencrypted. Use &quot;env:VAR_NAME&quot; to
                reference environment variables instead.
              </p>
              <label className="mt-2 flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={apiKeyConfirmed}
                  onChange={e => setApiKeyConfirmed(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm text-gray-300">
                  I understand the security risk of storing plain text API keys
                </span>
              </label>
              <p className="mt-1 text-xs text-gray-500">
                Use &quot;env:VAR_NAME&quot; to reference environment variables
              </p>
            </>
          )}
        </div>

        {/* Advanced Options Collapsible Section */}
        <div className="border-t border-surface-border pt-4">
          <button
            type="button"
            onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
            className="flex items-center justify-between w-full text-left text-sm font-medium text-gray-300 hover:text-text-base transition-colors"
          >
            <span>Advanced Options</span>
            <svg
              className={`w-4 h-4 transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {showAdvancedOptions && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  V1 Models (optional)
                </label>
                <input
                  type="text"
                  value={newServerV1Models}
                  onChange={e => setNewServerV1Models(e.target.value)}
                  placeholder="MiniMax-M2.7, MiniMax-M2.5, ..."
                  className="w-full bg-surface-raised border border-surface-border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Comma-separated list of V1-compatible models
                </p>
              </div>

              <div className="space-y-3">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newServerForceOllama}
                    onChange={e => setNewServerForceOllama(e.target.checked)}
                    className="w-4 h-4 rounded border-surface-border bg-surface-raised text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                  />
                  <span className="text-sm font-medium text-gray-300">Force Ollama support</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newServerForceV1}
                    onChange={e => setNewServerForceV1(e.target.checked)}
                    className="w-4 h-4 rounded border-surface-border bg-surface-raised text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                  />
                  <span className="text-sm font-medium text-gray-300">Force OpenAI support</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newServerForceAnthropic}
                    onChange={e => setNewServerForceAnthropic(e.target.checked)}
                    className="w-4 h-4 rounded border-surface-border bg-surface-raised text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                  />
                  <span className="text-sm font-medium text-gray-300">Force Anthropic support</span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Anthropic Path Override (optional)
                </label>
                <input
                  type="text"
                  value={newServerAnthropicPathOverride}
                  onChange={e => setNewServerAnthropicPathOverride(e.target.value)}
                  placeholder="/anthropic/v1/messages"
                  className="w-full bg-surface-raised border border-surface-border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              if (!newServerUrl) {
                setTestConnectionStatus('error');
                setTestConnectionMessage('Please enter a server URL first');
                return;
              }
              setTestConnectionStatus('testing');
              setTestConnectionMessage('');
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const response = await fetch(newServerUrl, {
                  method: 'HEAD',
                  signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (response.ok || response.status === 401) {
                  setTestConnectionStatus('success');
                  setTestConnectionMessage('Connection successful!');
                } else {
                  setTestConnectionStatus('error');
                  setTestConnectionMessage(`Server responded with status ${response.status}`);
                }
              } catch (err) {
                setTestConnectionStatus('error');
                setTestConnectionMessage(err instanceof Error ? err.message : 'Connection failed');
              }
            }}
            disabled={testConnectionStatus === 'testing'}
          >
            <Wifi className="w-4 h-4 mr-2" />
            {testConnectionStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={addMutation.isPending}
            disabled={!apiKeyConfirmed || addMutation.isPending}
          >
            {addMutation.isPending ? 'Adding...' : 'Add Server'}
          </Button>
        </div>
        {testConnectionStatus !== 'idle' && testConnectionMessage && (
          <div
            className={`mt-2 p-3 rounded-lg text-sm ${
              testConnectionStatus === 'success'
                ? 'bg-green-900/30 text-green-400 border border-green-800'
                : 'bg-red-900/30 text-red-400 border border-red-800'
            }`}
          >
            {testConnectionStatus === 'success' && <CheckCircle className="w-4 h-4 inline mr-2" />}
            {testConnectionStatus === 'error' && <XCircle className="w-4 h-4 inline mr-2" />}
            {testConnectionMessage}
          </div>
        )}
      </form>
    </Modal>
  );
});

import { useState, type FormEvent } from 'react';
import { ArrowLeft, Plus, Server, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { toastSuccess, toastError } from '../utils/toast';
import { addServer } from '../api/servers';
import type { AdminFormData } from './AdminStep';

interface ServerStepProps {
  adminData: AdminFormData;
  onComplete: () => void;
  onBack: () => void;
}

export function ServerStep({ adminData, onComplete, onBack }: ServerStepProps) {
  const [serverUrl, setServerUrl] = useState('http://localhost:11434');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFinish = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const { setup } = await import('../api/setup');
      const result = await setup(adminData);

      if (!result.success) {
        toastError(result.message || 'Setup failed');
        setError(result.message || 'Setup failed');
        return;
      }

      if (serverUrl && serverUrl.trim()) {
        try {
          const serverId = new URL(serverUrl).hostname || 'local';
          await addServer({ id: serverId, url: serverUrl.trim() });
          toastSuccess('Server added successfully');
        } catch {
          toastSuccess('Admin created. Server could not be added - you can add it later.');
        }
      }

      toastSuccess('Setup complete! Please log in.');
      onComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Setup failed';
      toastError(message);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const { setup } = await import('../api/setup');
      const result = await setup(adminData);

      if (!result.success) {
        toastError(result.message || 'Setup failed');
        setError(result.message || 'Setup failed');
        return;
      }

      toastSuccess('Setup complete! Please log in.');
      onComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Setup failed';
      toastError(message);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Add First Server</CardTitle>
        <CardDescription>
          Optionally add an Ollama server to get started. You can skip this and add servers later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="serverUrl">Server URL</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="serverUrl"
                  type="url"
                  value={serverUrl}
                  onChange={e => setServerUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="pl-9"
                  disabled={isLoading}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The URL of your Ollama server (e.g., http://localhost:11434)
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              className="flex-1 gap-2"
              disabled={isLoading}
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleSkip}
              className="flex-1"
              disabled={isLoading}
            >
              Skip
            </Button>
            <Button
              type="button"
              onClick={handleFinish}
              className="flex-1 gap-2"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="animate-pulse">Creating...</span>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Add Server
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

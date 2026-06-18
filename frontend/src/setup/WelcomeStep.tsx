import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/button';

interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
      <div className="mb-6 p-4 rounded-full bg-primary/10">
        <Sparkles className="w-12 h-12 text-primary" />
      </div>
      <h1 className="text-3xl font-bold mb-4">Welcome to Ollama Orchestrator</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        This wizard will help you set up your admin account and configure your first Ollama server.
        Let&apos;s get started!
      </p>
      <Button onClick={onNext} size="lg" className="gap-2">
        Get Started
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

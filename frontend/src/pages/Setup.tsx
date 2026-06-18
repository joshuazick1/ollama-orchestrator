import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { AdminStep, type AdminFormData } from '../setup/AdminStep';
import { WelcomeStep } from '../setup/WelcomeStep';
import { ServerStep } from '../setup/ServerStep';

type Step = 'welcome' | 'admin' | 'server';

const STEPS: { id: Step; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'admin', label: 'Admin' },
  { id: 'server', label: 'Server' },
];

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const currentIndex = STEPS.findIndex(s => s.id === currentStep);

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((step, index) => (
        <div key={step.id} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
              index < currentIndex
                ? 'bg-primary text-primary-foreground'
                : index === currentIndex
                  ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {index < currentIndex ? <ShieldCheck className="w-4 h-4" /> : index + 1}
          </div>
          <span
            className={`text-sm font-medium hidden sm:block ${
              index <= currentIndex ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {step.label}
          </span>
          {index < STEPS.length - 1 && (
            <div className={`w-8 h-0.5 mx-1 ${index < currentIndex ? 'bg-primary' : 'bg-muted'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export function Setup() {
  const [step, setStep] = useState<Step>('welcome');
  const [adminData, setAdminData] = useState<AdminFormData | null>(null);
  const navigate = useNavigate();

  const handleWelcomeNext = () => setStep('admin');
  const handleAdminNext = (data: AdminFormData) => {
    setAdminData(data);
    setStep('server');
  };
  const handleAdminBack = () => setStep('welcome');
  const handleServerBack = () => setStep('admin');
  const handleComplete = () => navigate('/login');

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Ollama Orchestrator
          </h1>
        </div>

        <StepIndicator currentStep={step} />

        <div className="bg-surface-raised rounded-2xl border border-border p-6 shadow-lg">
          {step === 'welcome' && <WelcomeStep onNext={handleWelcomeNext} />}
          {step === 'admin' && <AdminStep onNext={handleAdminNext} onBack={handleAdminBack} />}
          {step === 'server' && adminData && (
            <ServerStep
              adminData={adminData}
              onComplete={handleComplete}
              onBack={handleServerBack}
            />
          )}
        </div>
      </div>
    </div>
  );
}

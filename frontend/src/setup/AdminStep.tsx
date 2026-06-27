import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export interface AdminFormData {
  username: string;
  email: string;
  password: string;
}

interface AdminStepProps {
  onNext: (data: AdminFormData) => void;
  onBack: () => void;
}

const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export function AdminStep({ onNext, onBack }: AdminStepProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ username?: string; email?: string; password?: string }>(
    {}
  );

  const validate = (): boolean => {
    const newErrors: { username?: string; email?: string; password?: string } = {};

    if (!username) {
      newErrors.username = 'Username is required';
    } else if (username.length < 3 || username.length > 64) {
      newErrors.username = 'Username must be 3-64 characters';
    } else if (!USERNAME_REGEX.test(username)) {
      newErrors.username = 'Username can only contain letters, numbers, underscores, and hyphens';
    }

    if (email && (email.length < 5 || !email.includes('@'))) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 16) {
      newErrors.password = 'Password must be at least 16 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onNext({ username, email, password });
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Create Admin Account</CardTitle>
        <CardDescription>
          Set up your administrator account to manage the orchestrator
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
            />
            {errors.username && (
              <div className="flex items-center gap-1 text-sm text-destructive">
                <AlertCircle className="w-3 h-3" />
                <span>{errors.username}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email (optional)</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              autoComplete="email"
            />
            {errors.email && (
              <div className="flex items-center gap-1 text-sm text-destructive">
                <AlertCircle className="w-3 h-3" />
                <span>{errors.email}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Minimum 16 characters"
              autoComplete="new-password"
            />
            {errors.password && (
              <div className="flex items-center gap-1 text-sm text-destructive">
                <AlertCircle className="w-3 h-3" />
                <span>{errors.password}</span>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onBack} className="flex-1 gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <Button type="submit" className="flex-1 gap-2">
              Next
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

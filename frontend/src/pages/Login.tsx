import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogIn, AlertCircle, ShieldOff, Loader2, UserPlus } from 'lucide-react';
import { setup } from '../api/setup';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const {
    authEnabled,
    setupRequired,
    isLoading: authLoading,
    login,
    logout,
    refreshAuthStatus,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: Location })?.from?.pathname || '/';

  const handleDevModeContinue = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetupSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await setup({ username, email, password });
      await refreshAuthStatus();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Branch 1: Still checking auth status
  if (authLoading || authEnabled === null) {
    return (
      <div className="min-h-screen bg-surface-raised flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-surface rounded-2xl border border-surface-border p-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent mb-2">
                Orchestrator
              </h1>
              <p className="text-text-muted">Checking authentication...</p>
            </div>
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Branch 2: Auth disabled (dev mode)
  if (authEnabled === false) {
    return (
      <div className="min-h-screen bg-surface-raised flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-surface rounded-2xl border border-surface-border p-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent mb-2">
                Orchestrator
              </h1>
              <p className="text-text-muted">Sign in to your account</p>
            </div>

            <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <ShieldOff className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                <span className="text-yellow-400 font-medium text-sm">
                  Development Mode — Auth Disabled
                </span>
              </div>
              <p className="text-text-muted text-sm mb-3">
                Authentication is not required in this environment.
              </p>
              <button
                onClick={handleDevModeContinue}
                className="text-blue-400 hover:text-blue-300 text-sm font-medium underline"
              >
                Continue to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Branch 3: Setup required (first-time setup)
  if (setupRequired) {
    return (
      <div className="min-h-screen bg-surface-raised flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-surface rounded-2xl border border-surface-border p-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent mb-2">
                Orchestrator
              </h1>
              <p className="text-text-muted">Create your admin account</p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-900/20 border border-red-500/20 rounded-lg flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <span className="text-red-400 text-sm">{error}</span>
              </div>
            )}

            <form onSubmit={handleSetupSubmit} className="space-y-6">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-2">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  className="w-full bg-surface-raised border border-gray-600 rounded-lg px-4 py-3 text-text-base placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                  placeholder="Enter admin username"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                  Email (optional)
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-surface-raised border border-gray-600 rounded-lg px-4 py-3 text-text-base placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                  placeholder="admin@example.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full bg-surface-raised border border-gray-600 rounded-lg px-4 py-3 text-text-base placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                  placeholder="Enter password"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-text-base font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <span className="animate-pulse">Creating Admin...</span>
                ) : (
                  <>
                    <UserPlus className="w-5 h-5" />
                    Create Admin
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Branch 4: Normal login (auth enabled, setup complete)
  return (
    <div className="min-h-screen bg-surface-raised flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-surface rounded-2xl border border-surface-border p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent mb-2">
              Orchestrator
            </h1>
            <p className="text-text-muted">Sign in to your account</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-900/20 border border-red-500/20 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <span className="text-red-400 text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-2">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                className="w-full bg-surface-raised border border-gray-600 rounded-lg px-4 py-3 text-text-base placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                placeholder="Enter your username"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-surface-raised border border-gray-600 rounded-lg px-4 py-3 text-text-base placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                placeholder="Enter your password"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-text-base font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <span className="animate-pulse">Signing in...</span>
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  Sign In
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export { Login };

import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, Search, Sun, Moon, LogOut } from 'lucide-react';
import { cn } from '../lib/utils';
import { GlobalSearch } from './GlobalSearch';
import { PageTransition } from './PageTransition';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../contexts/AuthContext';
import { APP_VERSION } from '../constants/app';
import { NAV_ITEMS } from '../constants/navigation';

const NavigationItem = ({
  to,
  icon: Icon,
  children,
  onClick,
}: {
  to: string;
  icon: React.ElementType;
  children: React.ReactNode;
  onClick?: () => void;
}) => (
  <NavLink
    to={to}
    onClick={onClick}
    className={({ isActive }) =>
      cn(
        'flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors',
        isActive
          ? 'bg-primary text-text-base'
          : 'text-text-muted hover:bg-surface-raised dark:hover:bg-surface-raised hover:text-text-base dark:text-text-muted'
      )
    }
  >
    <Icon className="w-5 h-5" />
    <span className="font-medium">{children}</span>
  </NavLink>
);

const ThemeToggle = ({
  compact = false,
  theme,
  toggleTheme,
}: {
  compact?: boolean;
  theme: string;
  toggleTheme: () => void;
}) => (
  <button
    onClick={toggleTheme}
    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    className={cn(
      'rounded-lg transition-colors text-text-muted hover:text-text-base',
      compact
        ? 'p-2 hover:bg-surface-raised'
        : 'flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-raised'
    )}
  >
    {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    {!compact && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
  </button>
);

export const Layout = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { isSearchOpen, openSearch, closeSearch } = useGlobalSearch();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const location = useLocation();

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-text-base focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
      >
        Skip to content
      </a>

      <div className="flex h-screen bg-surface dark:bg-surface light:bg-gray-50 text-text-base overflow-hidden">
        <GlobalSearch
          key={isSearchOpen ? 'open' : 'closed'}
          isOpen={isSearchOpen}
          onClose={closeSearch}
        />

        <aside className="hidden md:flex w-64 bg-surface-raised border-r border-surface-border flex-col">
          <div className="p-6">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              Orchestrator
            </h1>
            <button
              onClick={openSearch}
              className="mt-3 w-full flex items-center gap-2 px-3 py-2 bg-surface hover:bg-surface-raised rounded-lg text-sm text-text-muted hover:text-text-base transition-colors"
            >
              <Search className="w-4 h-4" />
              <span>Search...</span>
              <kbd className="ml-auto px-1.5 py-0.5 bg-gray-700 rounded text-xs">⌘K</kbd>
            </button>
          </div>

          <nav className="flex-1 px-3 space-y-1">
            {NAV_ITEMS.map(item => (
              <NavigationItem key={item.to} to={item.to} icon={item.icon}>
                {item.label}
              </NavigationItem>
            ))}
          </nav>

          <div className="p-4 border-t border-surface-border flex flex-col gap-3">
            {user && (
              <div className="text-xs text-text-muted px-2">
                <span className="font-medium text-text-base">{user.username}</span>
                <span className="ml-1 text-text-subtle">({user.role})</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-subtle">{APP_VERSION}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => logout()}
                  className="p-1.5 text-text-muted hover:text-text-base hover:bg-surface-raised rounded transition-colors"
                  aria-label="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
                <ThemeToggle compact theme={theme} toggleTheme={toggleTheme} />
              </div>
            </div>
          </div>
        </aside>

        <div className="fixed top-0 left-0 right-0 z-40 md:hidden bg-surface-raised border-b border-surface-border px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Orchestrator
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={openSearch}
              className="p-2 text-text-muted hover:text-text-base rounded-lg hover:bg-surface-raised transition-colors"
              aria-label="Search"
            >
              <Search className="w-5 h-5" />
            </button>
            <ThemeToggle compact theme={theme} toggleTheme={toggleTheme} />
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <button
                  className="p-2 text-text-muted hover:text-text-base rounded-lg hover:bg-surface-raised transition-colors"
                  aria-label="Toggle menu"
                >
                  <Menu className="w-6 h-6" />
                </button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="bg-surface-raised border-surface-border w-64 p-0"
              >
                <SheetHeader className="p-6 pb-0">
                  <SheetTitle className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                    Orchestrator
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
                  {NAV_ITEMS.map(item => (
                    <NavigationItem
                      key={item.to}
                      to={item.to}
                      icon={item.icon}
                      onClick={closeMobileMenu}
                    >
                      {item.label}
                    </NavigationItem>
                  ))}
                </nav>
                <div className="p-4 border-t border-surface-border flex flex-col gap-3">
                  {user && (
                    <div className="text-xs text-text-muted px-2">
                      <span className="font-medium text-text-base">{user.username}</span>
                      <span className="ml-1 text-text-subtle">({user.role})</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-subtle">{APP_VERSION}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => logout()}
                        className="p-1.5 text-text-muted hover:text-text-base hover:bg-surface-raised rounded transition-colors"
                        aria-label="Logout"
                      >
                        <LogOut className="w-4 h-4" />
                      </button>
                      <ThemeToggle compact theme={theme} toggleTheme={toggleTheme} />
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        <main id="main-content" className="flex-1 overflow-auto bg-surface pt-16 md:pt-0">
          <div className="p-4 md:p-8 max-w-7xl mx-auto">
            <PageTransition key={location.pathname}>
              <Outlet />
            </PageTransition>
          </div>
        </main>
      </div>
    </>
  );
};

export default Layout;

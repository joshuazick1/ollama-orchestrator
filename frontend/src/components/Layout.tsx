import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Menu, X, Search, Sun, Moon } from 'lucide-react';
import clsx from 'clsx';
import { GlobalSearch } from './GlobalSearch';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { useTheme } from '../hooks/useTheme';
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
      clsx(
        'flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors',
        isActive
          ? 'bg-blue-600 text-white'
          : 'text-gray-400 hover:bg-gray-800 dark:hover:bg-gray-800 hover:text-white dark:text-gray-400'
      )
    }
  >
    <Icon className="w-5 h-5" />
    <span className="font-medium">{children}</span>
  </NavLink>
);

export const Layout = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { isSearchOpen, openSearch, closeSearch } = useGlobalSearch();
  const { theme, toggleTheme } = useTheme();

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  const ThemeToggle = ({ compact = false }: { compact?: boolean }) => (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={clsx(
        'rounded-lg transition-colors text-gray-400 hover:text-white',
        compact
          ? 'p-2 hover:bg-gray-800'
          : 'flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-800'
      )}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      {!compact && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );

  return (
    <div className="flex h-screen bg-gray-900 dark:bg-gray-900 light:bg-gray-50 text-white overflow-hidden">
      <GlobalSearch
        key={isSearchOpen ? 'open' : 'closed'}
        isOpen={isSearchOpen}
        onClose={closeSearch}
      />

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 bg-gray-950 border-r border-gray-800 flex-col">
        <div className="p-6">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Orchestrator
          </h1>
          <button
            onClick={openSearch}
            className="mt-3 w-full flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
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

        <div className="p-4 border-t border-gray-800 flex items-center justify-between">
          <span className="text-xs text-gray-500">{APP_VERSION}</span>
          <ThemeToggle compact />
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="fixed top-0 left-0 right-0 z-40 md:hidden bg-gray-950 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Orchestrator
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={openSearch}
            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
            aria-label="Search"
          >
            <Search className="w-5 h-5" />
          </button>
          <ThemeToggle compact />
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={closeMobileMenu} />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 w-64 bg-gray-950 border-r border-gray-800 flex flex-col transform transition-transform duration-300 md:hidden',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="p-6">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Orchestrator
          </h1>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <NavigationItem key={item.to} to={item.to} icon={item.icon} onClick={closeMobileMenu}>
              {item.label}
            </NavigationItem>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800 flex items-center justify-between">
          <span className="text-xs text-gray-500">{APP_VERSION}</span>
          <ThemeToggle compact />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-900 pt-16 md:pt-0">
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

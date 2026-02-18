import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  Database,
  Layers,
  BarChart2,
  Shield,
  Settings,
  FileText,
  Menu,
  X,
  Search,
} from 'lucide-react';
import clsx from 'clsx';
import { GlobalSearch, useGlobalSearch } from './GlobalSearch';

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
        isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
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

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="flex h-screen bg-gray-900 text-white overflow-hidden">
      <GlobalSearch isOpen={isSearchOpen} onClose={closeSearch} />

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
          <NavigationItem to="/" icon={LayoutDashboard}>
            Dashboard
          </NavigationItem>
          <NavigationItem to="/servers" icon={Server}>
            Servers
          </NavigationItem>
          <NavigationItem to="/models" icon={Database}>
            Models
          </NavigationItem>
          <NavigationItem to="/queue" icon={Layers}>
            Queue
          </NavigationItem>
          <NavigationItem to="/analytics" icon={BarChart2}>
            Analytics
          </NavigationItem>
          <NavigationItem to="/circuit-breakers" icon={Shield}>
            Circuit Breakers
          </NavigationItem>
          <NavigationItem to="/logs" icon={FileText}>
            Logs
          </NavigationItem>
          <NavigationItem to="/settings" icon={Settings}>
            Settings
          </NavigationItem>
        </nav>

        <div className="p-4 border-t border-gray-800 text-xs text-gray-500">v1.0.0</div>
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
          <NavigationItem to="/" icon={LayoutDashboard} onClick={closeMobileMenu}>
            Dashboard
          </NavigationItem>
          <NavigationItem to="/servers" icon={Server} onClick={closeMobileMenu}>
            Servers
          </NavigationItem>
          <NavigationItem to="/models" icon={Database} onClick={closeMobileMenu}>
            Models
          </NavigationItem>
          <NavigationItem to="/queue" icon={Layers} onClick={closeMobileMenu}>
            Queue
          </NavigationItem>
          <NavigationItem to="/analytics" icon={BarChart2} onClick={closeMobileMenu}>
            Analytics
          </NavigationItem>
          <NavigationItem to="/circuit-breakers" icon={Shield} onClick={closeMobileMenu}>
            Circuit Breakers
          </NavigationItem>
          <NavigationItem to="/logs" icon={FileText} onClick={closeMobileMenu}>
            Logs
          </NavigationItem>
          <NavigationItem to="/settings" icon={Settings} onClick={closeMobileMenu}>
            Settings
          </NavigationItem>
        </nav>

        <div className="p-4 border-t border-gray-800 text-xs text-gray-500">v1.0.0</div>
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

import React from 'react';
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
} from 'lucide-react';
import clsx from 'clsx';

const NavigationItem = ({
  to,
  icon: Icon,
  children,
}: {
  to: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) => (
  <NavLink
    to={to}
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
  return (
    <div className="flex h-screen bg-gray-900 text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-950 border-r border-gray-800 flex flex-col">
        <div className="p-6">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Orchestrator
          </h1>
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

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-900">
        <div className="p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

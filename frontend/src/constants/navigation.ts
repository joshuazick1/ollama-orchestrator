import {
  LayoutDashboard,
  Server,
  Database,
  Zap,
  BarChart2,
  Shield,
  Settings,
  FileText,
  AlertTriangle,
  Activity,
  Network,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/servers', icon: Server, label: 'Servers' },
  { to: '/models', icon: Database, label: 'Models' },
  { to: '/in-flight', icon: Zap, label: 'In-Flight' },
  { to: '/analytics', icon: BarChart2, label: 'Analytics' },
  { to: '/circuit-breakers', icon: Shield, label: 'Circuit Breakers' },
  { to: '/logs', icon: FileText, label: 'Logs' },
  { to: '/errors', icon: AlertTriangle, label: 'Error Events' },
  { to: '/probe', icon: Activity, label: 'Probe' },
  { to: '/cluster', icon: Network, label: 'Cluster' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

import { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown, FileSpreadsheet, FileJson, FileText } from 'lucide-react';
import {
  exportPerformanceMetricsToCSV,
  exportTopModelsToCSV,
  exportCircuitBreakersToCSV,
  exportToHTMLReport,
  downloadJSON,
} from '../../utils/export';
import type { CircuitBreakerInfo } from '../../api';

interface ExportDropdownProps {
  timeRange: string;
  serverPerformance?: Array<{
    id: string;
    requests: number;
    avgLatency: number;
    p95Latency: number;
    errorRate: number;
    throughput: number;
    score: number;
  }>;
  topModels?: Array<{ model: string; requests: number }>;
  circuitBreakers?: CircuitBreakerInfo[];
  summary?: {
    global?: {
      totalRequests: number;
      errorRate: number;
      avgLatency: number;
      requestsPerSecond: number;
    };
  };
}

export const ExportDropdown = ({
  timeRange,
  serverPerformance,
  topModels,
  circuitBreakers,
  summary,
}: ExportDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = (type: 'csv' | 'json' | 'html') => {
    switch (type) {
      case 'csv':
        if (serverPerformance && serverPerformance.length > 0) {
          exportPerformanceMetricsToCSV(serverPerformance, timeRange);
        } else if (topModels && topModels.length > 0) {
          exportTopModelsToCSV(topModels, timeRange);
        } else if (circuitBreakers && circuitBreakers.length > 0) {
          exportCircuitBreakersToCSV(
            circuitBreakers.map(cb => ({
              serverId: cb.serverId,
              state: cb.state,
              failureCount: cb.failureCount,
              successCount: cb.successCount,
              errorRate: cb.errorRate,
              consecutiveSuccesses: cb.consecutiveSuccesses,
              lastFailure: cb.lastFailure ? new Date(cb.lastFailure).toISOString() : undefined,
            }))
          );
        }
        break;
      case 'json':
        downloadJSON(
          { serverPerformance, topModels, circuitBreakers, summary, timeRange },
          `analytics-${timeRange}-${Date.now()}`
        );
        break;
      case 'html':
        if (summary?.global) {
          exportToHTMLReport(
            'Analytics Report',
            [
              {
                title: 'Summary',
                content: [
                  ['Total Requests', String(summary.global.totalRequests)],
                  ['Error Rate', `${(summary.global.errorRate * 100).toFixed(2)}%`],
                  ['Avg Latency', `${summary.global.avgLatency.toFixed(2)}ms`],
                  ['Requests/sec', summary.global.requestsPerSecond.toFixed(2)],
                ],
              },
            ],
            timeRange,
            `analytics-report-${timeRange}`
          );
        }
        break;
    }
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm hover:border-gray-600 transition-colors"
      >
        <Download className="w-4 h-4" />
        Export
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50">
          <button
            onClick={() => handleExport('csv')}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-gray-700 rounded-t-lg transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-green-400" />
            Export CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
          >
            <FileJson className="w-4 h-4 text-yellow-400" />
            Export JSON
          </button>
          <button
            onClick={() => handleExport('html')}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-gray-700 rounded-b-lg transition-colors"
          >
            <FileText className="w-4 h-4 text-blue-400" />
            Export Report
          </button>
        </div>
      )}
    </div>
  );
};

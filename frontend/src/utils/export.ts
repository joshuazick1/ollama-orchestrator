export const exportToCSV = <T extends Record<string, unknown>>(
  data: T[],
  filename: string,
  columns?: { key: keyof T; header: string }[]
): void => {
  if (data.length === 0) {
    console.warn('No data to export');
    return;
  }

  const headers = columns ? columns.map(c => c.header) : Object.keys(data[0]);

  const keys = columns ? columns.map(c => c.key) : (Object.keys(data[0]) as (keyof T)[]);

  const csvRows = [
    headers.join(','),
    ...data.map(row =>
      keys
        .map(key => {
          const value = row[key];
          const stringValue = value === null || value === undefined ? '' : String(value);
          if (
            stringValue.includes(',') ||
            stringValue.includes('"') ||
            stringValue.includes('\n')
          ) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        })
        .join(',')
    ),
  ];

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportPerformanceMetricsToCSV = (
  data: Array<{
    id: string;
    requests: number;
    avgLatency: number;
    p95Latency: number;
    errorRate: number;
    throughput: number;
    score: number;
  }>,
  timeRange: string
): void => {
  exportToCSV(data, `performance-metrics-${timeRange}-${Date.now()}`, [
    { key: 'id', header: 'Server ID' },
    { key: 'requests', header: 'Requests' },
    { key: 'avgLatency', header: 'Avg Latency (ms)' },
    { key: 'p95Latency', header: 'P95 Latency (ms)' },
    { key: 'errorRate', header: 'Error Rate' },
    { key: 'throughput', header: 'Throughput (rpm)' },
    { key: 'score', header: 'Score' },
  ]);
};

export const exportRequestHistoryToCSV = (
  data: Array<{
    id: string;
    model: string;
    timestamp: string;
    duration: number;
    success: boolean;
    tokensGenerated?: number;
    errorType?: string;
  }>,
  serverId: string
): void => {
  exportToCSV(data, `request-history-${serverId}-${Date.now()}`, [
    { key: 'id', header: 'Request ID' },
    { key: 'model', header: 'Model' },
    { key: 'timestamp', header: 'Timestamp' },
    { key: 'duration', header: 'Duration (ms)' },
    { key: 'success', header: 'Success' },
    { key: 'tokensGenerated', header: 'Tokens Generated' },
    { key: 'errorType', header: 'Error Type' },
  ]);
};

export const exportTopModelsToCSV = (
  data: Array<{
    model: string;
    requests: number;
  }>,
  timeRange: string
): void => {
  exportToCSV(data, `top-models-${timeRange}-${Date.now()}`, [
    { key: 'model', header: 'Model Name' },
    { key: 'requests', header: 'Total Requests' },
  ]);
};

export const exportCircuitBreakersToCSV = (
  data: Array<{
    serverId: string;
    state: string;
    failureCount: number;
    successCount: number;
    errorRate: number;
    consecutiveSuccesses: number;
    lastFailure?: string;
  }>
): void => {
  exportToCSV(data, `circuit-breakers-${Date.now()}`, [
    { key: 'serverId', header: 'Server ID' },
    { key: 'state', header: 'State' },
    { key: 'failureCount', header: 'Failures' },
    { key: 'successCount', header: 'Successes' },
    { key: 'errorRate', header: 'Error Rate (%)' },
    { key: 'consecutiveSuccesses', header: 'Consecutive Successes' },
    { key: 'lastFailure', header: 'Last Failure' },
  ]);
};

export const exportQueueDataToCSV = (
  data: Array<{
    id: string;
    model: string;
    endpoint: string;
    priority: number;
    enqueueTime: string;
    waitTime: number;
  }>
): void => {
  exportToCSV(data, `queue-data-${Date.now()}`, [
    { key: 'id', header: 'Request ID' },
    { key: 'model', header: 'Model' },
    { key: 'endpoint', header: 'Endpoint' },
    { key: 'priority', header: 'Priority' },
    { key: 'enqueueTime', header: 'Enqueue Time' },
    { key: 'waitTime', header: 'Wait Time (ms)' },
  ]);
};

export const generateReportHTML = (
  title: string,
  sections: Array<{
    title: string;
    content: Array<Array<string | number>>;
  }>,
  timeRange: string
): string => {
  const timestamp = new Date().toLocaleString();

  return `
<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; background: #1f2937; color: #f3f4f6; }
    h1 { color: #f3f4f6; border-bottom: 1px solid #374151; padding-bottom: 16px; }
    h2 { color: #9ca3af; margin-top: 32px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #374151; }
    th { background: #374151; font-weight: 600; }
    .metric { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #374151; }
    .metric-label { color: #9ca3af; }
    .metric-value { font-weight: 600; }
    .timestamp { color: #6b7280; font-size: 14px; margin-top: 8px; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-success { background: #065f46; color: #34d399; }
    .badge-warning { background: #78350f; color: #fbbf24; }
    .badge-error { background: #7f1d1d; color: #f87171; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="timestamp">Generated: ${timestamp} | Time Range: ${timeRange}</p>
  
  ${sections
    .map(
      section => `
    <h2>${section.title}</h2>
    <table>
      ${section.content
        .map(
          (row: Array<string | number>) => `
        <tr>
          ${row.map((cell: string | number) => `<td>${cell}</td>`).join('')}
        </tr>
      `
        )
        .join('')}
    </table>
  `
    )
    .join('')}
</body>
</html>
  `.trim();
};

export const exportToHTMLReport = (
  title: string,
  sections: Array<{
    title: string;
    content: Array<Array<string | number>>;
  }>,
  timeRange: string,
  filename: string
): void => {
  const html = generateReportHTML(title, sections, timeRange);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.html`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const downloadJSON = (data: unknown, filename: string): void => {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.json`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

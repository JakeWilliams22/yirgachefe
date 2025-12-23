/**
 * InsightsView component - Displays generated insights from the CodeWriterAgent
 */

import type { Insight, StatisticValue, RankingValue, TimelineValue, DistributionValue, AchievementValue } from '../types/insights';
import './InsightsView.css';

interface InsightsViewProps {
  insights: Insight[];
}

export function InsightsView({ insights }: InsightsViewProps) {
  if (insights.length === 0) {
    return (
      <div className="insights-empty">
        <p>No insights generated yet.</p>
      </div>
    );
  }

  return (
    <div className="insights-view">
      <h3>Generated Insights ({insights.length})</h3>
      <div className="insights-grid">
        {insights.map((insight) => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className={`insight-card insight-type-${insight.type}`}>
      <div className="insight-header">
        <span className="insight-category">{insight.category}</span>
        <span className="insight-type-badge">{insight.type}</span>
      </div>
      <h4 className="insight-title">{insight.title}</h4>
      <div className="insight-value">
        {renderInsightValue(insight.type, insight.value)}
      </div>
      {insight.metadata && (
        <div className="insight-metadata">
          {insight.metadata.unit && <span className="metadata-unit">{insight.metadata.unit}</span>}
          {insight.metadata.timeframe && <span className="metadata-timeframe">{insight.metadata.timeframe}</span>}
          {insight.metadata.source && <span className="metadata-source">{insight.metadata.source}</span>}
        </div>
      )}
    </div>
  );
}

function renderInsightValue(type: string, value: unknown) {
  switch (type) {
    case 'statistic':
      return <StatisticDisplay value={value as StatisticValue} />;
    case 'ranking':
      return <RankingDisplay value={value as RankingValue} />;
    case 'timeline':
      return <TimelineDisplay value={value as TimelineValue} />;
    case 'distribution':
      return <DistributionDisplay value={value as DistributionValue} />;
    case 'comparison':
      return <ComparisonDisplay value={value} />;
    case 'achievement':
      return <AchievementDisplay value={value as AchievementValue} />;
    default:
      return <pre>{JSON.stringify(value, null, 2)}</pre>;
  }
}

function StatisticDisplay({ value }: { value: StatisticValue }) {
  return (
    <div className="statistic-display">
      <div className="statistic-number">
        {formatNumber(value.number)}
        {value.label && <span className="statistic-label">{value.label}</span>}
      </div>
      {value.comparison && (
        <div className="statistic-comparison">
          <span className={value.comparison.change >= 0 ? 'comparison-positive' : 'comparison-negative'}>
            {value.comparison.change >= 0 ? '↑' : '↓'} {Math.abs(value.comparison.changePercent)}%
          </span>
          <span className="comparison-previous">vs {formatNumber(value.comparison.previous)}</span>
        </div>
      )}
    </div>
  );
}

function RankingDisplay({ value }: { value: RankingValue }) {
  return (
    <ol className="ranking-list">
      {value.items.slice(0, 5).map((item) => (
        <li key={item.rank} className="ranking-item">
          <span className="ranking-rank">#{item.rank}</span>
          <span className="ranking-name">{item.name}</span>
          <span className="ranking-value">{formatNumber(item.value)}</span>
        </li>
      ))}
    </ol>
  );
}

function TimelineDisplay({ value }: { value: TimelineValue }) {
  // For now, just show data points as a list
  // In the future, this could be a chart
  const points = value.dataPoints.slice(0, 10);
  return (
    <div className="timeline-display">
      <div className="timeline-points">
        {points.map((point, index) => (
          <div key={index} className="timeline-point">
            <span className="timeline-timestamp">
              {typeof point.timestamp === 'string' ? point.timestamp : point.timestamp.toLocaleDateString()}
            </span>
            <span className="timeline-value">{formatNumber(point.value)}</span>
            {point.label && <span className="timeline-label">{point.label}</span>}
          </div>
        ))}
      </div>
      {value.dataPoints.length > 10 && (
        <div className="timeline-more">...and {value.dataPoints.length - 10} more data points</div>
      )}
    </div>
  );
}

function DistributionDisplay({ value }: { value: DistributionValue }) {
  return (
    <div className="distribution-display">
      {value.categories.slice(0, 8).map((category, index) => (
        <div key={index} className="distribution-item">
          <div className="distribution-header">
            <span className="distribution-name">{category.name}</span>
            <span className="distribution-percentage">{category.percentage.toFixed(1)}%</span>
          </div>
          <div className="distribution-bar">
            <div
              className="distribution-bar-fill"
              style={{ width: `${category.percentage}%` }}
            />
          </div>
          <span className="distribution-value">{formatNumber(category.value)}</span>
        </div>
      ))}
      {value.categories.length > 8 && (
        <div className="distribution-more">...and {value.categories.length - 8} more categories</div>
      )}
    </div>
  );
}

function ComparisonDisplay({ value }: { value: any }) {
  const change = value.change || 0;
  const changePercent = value.changePercent || 0;

  return (
    <div className="comparison-display">
      <div className="comparison-row">
        <div className="comparison-item">
          <span className="comparison-label">{value.current?.label || 'Current'}</span>
          <span className="comparison-number">{formatNumber(value.current?.value || 0)}</span>
        </div>
        <div className="comparison-arrow">→</div>
        <div className="comparison-item">
          <span className="comparison-label">{value.previous?.label || 'Previous'}</span>
          <span className="comparison-number">{formatNumber(value.previous?.value || 0)}</span>
        </div>
      </div>
      <div className="comparison-change">
        <span className={change >= 0 ? 'change-positive' : 'change-negative'}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(changePercent).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function AchievementDisplay({ value }: { value: AchievementValue }) {
  return (
    <div className="achievement-display">
      <div className={`achievement-badge ${value.achieved ? 'achievement-achieved' : 'achievement-progress'}`}>
        {value.achieved ? '🏆' : '⭐'}
      </div>
      <p className="achievement-description">{value.description}</p>
      {!value.achieved && value.progress !== undefined && (
        <div className="achievement-progress-bar">
          <div
            className="achievement-progress-fill"
            style={{ width: `${value.progress * 100}%` }}
          />
          <span className="achievement-progress-text">
            {value.current && value.milestone
              ? `${formatNumber(value.current)} / ${formatNumber(value.milestone)}`
              : `${(value.progress * 100).toFixed(0)}%`}
          </span>
        </div>
      )}
    </div>
  );
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

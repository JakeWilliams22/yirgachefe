/**
 * PhaseIndicator component - Shows high-level progress through the analysis pipeline
 */

import './PhaseIndicator.css';

interface PhaseIndicatorProps {
  currentPhase: 'exploring' | 'writing-code' | 'presenting' | 'results';
}

interface Phase {
  id: string;
  label: string;
  icon: string;
}

const phases: Phase[] = [
  { id: 'exploring', label: 'Exploring Data', icon: '🔍' },
  { id: 'writing-code', label: 'Generating Insights', icon: '⚡' },
  { id: 'presenting', label: 'Creating Presentation', icon: '🎨' },
  { id: 'results', label: 'Complete', icon: '✨' },
];

export function PhaseIndicator({ currentPhase }: PhaseIndicatorProps) {
  const currentIndex = phases.findIndex((p) => p.id === currentPhase);

  return (
    <div className="phase-indicator">
      {phases.map((phase, index) => {
        const isActive = index === currentIndex;
        const isCompleted = index < currentIndex;
        const status = isCompleted ? 'completed' : isActive ? 'active' : 'pending';

        return (
          <div key={phase.id} className="phase-step-wrapper">
            <div className={`phase-step ${status}`}>
              <div className="phase-icon">{phase.icon}</div>
              <div className="phase-label">{phase.label}</div>
              {isActive && (
                <div className="phase-pulse" />
              )}
            </div>
            {index < phases.length - 1 && (
              <div className={`phase-connector ${isCompleted ? 'completed' : ''}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

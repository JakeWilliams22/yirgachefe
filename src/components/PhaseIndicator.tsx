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
  sublabel: string;
  icon: string;
}

const phases: Phase[] = [
  { id: 'exploring', label: 'Grinding Beans', sublabel: '(Exploring Data)', icon: '☕' },
  { id: 'writing-code', label: 'Brewing Coffee', sublabel: '(Generating Insights)', icon: '💧' },
  { id: 'presenting', label: 'Pouring Latte Art', sublabel: '(Creating Presentation)', icon: '🎨' },
  { id: 'results', label: 'Ready to Serve', sublabel: '(Complete)', icon: '✨' },
];

export function PhaseIndicator({ currentPhase }: PhaseIndicatorProps) {
  const currentIndex = phases.findIndex((p) => p.id === currentPhase);

  return (
    <div className="phase-indicator">
      <div className="phase-header">
        <h3 className="phase-title">Dominos Coffee Tracker</h3>
      </div>
        <p className="phase-timing">The full process usually takes ~5 minutes</p>
      <div className="phase-steps-container">
        {phases.map((phase, index) => {
          const isActive = index === currentIndex;
          const isCompleted = index < currentIndex;
          const status = isCompleted ? 'completed' : isActive ? 'active' : 'pending';

          return (
            <div key={phase.id} className="phase-step-wrapper">
              <div className={`phase-step ${status}`}>
                <div className="phase-icon">{phase.icon}</div>
                <div className="phase-label">{phase.label}</div>
                <div className="phase-sublabel">{phase.sublabel}</div>
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
    </div>
  );
}

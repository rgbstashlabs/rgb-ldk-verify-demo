import React from 'react';
import { useAppContext } from '../store';

export function StatePanel() {
  const { state } = useAppContext();

  return (
    <div className="p-3 px-4 border-t border-border bg-bg2 font-mono text-[11px] shrink-0">
      <div className="text-muted mb-1.5 font-bold tracking-wider">SESSION STATE</div>
      <div className="flex gap-2 flex-wrap">
        {Object.entries(state).map(([k, v]) => {
          const display = v ? (v.length > 20 ? v.slice(0, 8) + '…' + v.slice(-6) : v) : '—';
          return (
            <span key={k} className="flex items-center gap-1">
              <span className="text-muted">{k}:</span>
              <span className={`max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap ${v ? 'text-yellow' : 'text-border'}`} title={v || ''}>
                {display}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

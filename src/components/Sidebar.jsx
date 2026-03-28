import React from 'react';
import { useAppContext } from '../store';
import { CheckCircle2, XCircle, Circle } from 'lucide-react';

export function Sidebar({ steps }) {
  const { currentStep, setCurrentStep, stepDone, stepError } = useAppContext();

  return (
    <nav className="w-60 bg-bg2 border-r border-border flex flex-col shrink-0 overflow-y-auto">
      <div className="p-4 border-b border-border">
        <h1 className="text-[13px] font-bold text-text tracking-wide flex items-center gap-2">
          <span className="text-yellow text-base">⚡</span> RGB-LDK Demo
        </h1>
        <p className="text-[11px] text-muted mt-1">Integration Verification</p>
        <p className="text-[10px] text-muted mt-0.5">by Stash Labs</p>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {steps.map((s, i) => {
          const isActive = i === currentStep;
          const isDone = stepDone.has(i);
          const isError = stepError.has(i);
          
          return (
            <div
              key={s.id}
              onClick={() => setCurrentStep(i)}
              className={`px-4 py-2.5 cursor-pointer border-l-4 flex items-center gap-2.5 transition-colors hover:bg-bg3 ${
                isActive ? 'bg-bg3 border-blue' : isDone ? 'border-green' : isError ? 'border-red' : 'border-transparent'
              }`}
            >
              <span className="w-5 flex justify-center shrink-0">
                {isDone ? <CheckCircle2 size={16} className="text-green" /> : 
                 isError ? <XCircle size={16} className="text-red" /> : 
                 <span className="text-base">{s.icon}</span>}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`text-xs truncate ${isActive ? 'text-text font-medium' : isDone ? 'text-green' : 'text-muted'}`}>
                  {s.label}
                </div>
              </div>
              <div className="text-[10px] text-muted font-mono shrink-0">
                {String(i + 1).padStart(2, '0')}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

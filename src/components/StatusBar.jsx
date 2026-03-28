import React from 'react';
import { useAppContext } from '../store';

export function StatusBar() {
  const { nodeStatus, restoreState } = useAppContext();

  const StatusDot = ({ status, label }) => {
    const isOnline = status && status.status < 400;
    const height = status?.data?.best_block_height;
    
    return (
      <div className="flex items-center gap-1.5 text-xs font-mono">
        <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green shadow-[0_0_6px_#3fb950]' : 'bg-red'}`}></span>
        <span className={isOnline ? 'text-text' : 'text-muted'}>
          {label} {isOnline ? `✓ h:${height ?? '?'}` : '✗'}
        </span>
      </div>
    );
  };

  const BtcDot = ({ status }) => {
    const isOnline = !!status?.result;
    const height = status?.result?.blocks;
    
    return (
      <div className="flex items-center gap-1.5 text-xs font-mono">
        <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green shadow-[0_0_6px_#3fb950]' : 'bg-red'}`}></span>
        <span className={isOnline ? 'text-text' : 'text-muted'}>
          Bitcoin {isOnline ? `h:${height}` : '✗'}
        </span>
      </div>
    );
  };

  return (
    <div className="px-4 py-2 border-b border-border bg-bg2 flex gap-4 items-center shrink-0">
      <StatusDot status={nodeStatus.alice} label="Alice" />
      <StatusDot status={nodeStatus.bob} label="Bob" />
      <BtcDot status={nodeStatus.btc} />
      
      <span className="ml-auto text-[11px] text-muted font-mono">
        height: {nodeStatus.btc?.result?.blocks ?? '—'}
      </span>
      
      <button 
        onClick={() => restoreState(true)}
        title="Auto-detect asset_id, node_id, channel_id from live nodes"
        className="ml-3 px-2.5 py-1 text-[11px] font-bold bg-yellow text-black border-none rounded cursor-pointer hover:opacity-90 transition-opacity"
      >
        ↺ Restore State
      </button>
    </div>
  );
}

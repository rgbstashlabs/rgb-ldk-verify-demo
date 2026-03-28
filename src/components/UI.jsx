import React from 'react';

export function ApiBlock({ method, path, nodeLabel, children }) {
  const methodColor = method === 'GET' ? 'bg-[#1c3e2d] text-green' : 'bg-[#1e2d4a] text-blue';
  
  return (
    <div className="bg-bg2 border border-border rounded-lg mb-3 overflow-hidden">
      <div className="px-3.5 py-2.5 flex items-center gap-2.5 border-b border-border bg-bg3">
        <span className={`text-[11px] font-bold font-mono px-1.5 py-0.5 rounded ${methodColor}`}>
          {method}
        </span>
        <span className="font-mono text-xs text-text">{path}</span>
        {nodeLabel && <span className="ml-auto text-[11px] text-muted">{nodeLabel}</span>}
      </div>
      {children && (
        <div className="p-3.5">
          <pre className="font-mono text-xs text-muted whitespace-pre-wrap break-all">
            {children}
          </pre>
        </div>
      )}
    </div>
  );
}

export function SyntaxHighlight({ obj }) {
  if (!obj) return null;
  const json = JSON.stringify(obj, null, 2);
  
  // A simple regex-based syntax highlighter for React
  const renderHighlighted = () => {
    const parts = [];
    let lastIndex = 0;
    
    // Match strings, keys, numbers, booleans, null
    const regex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;
    
    let match;
    while ((match = regex.exec(json)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{json.slice(lastIndex, match.index)}</span>);
      }
      
      const val = match[0];
      let colorClass = 'text-text';
      
      if (/^"/.test(val)) {
        if (/:$/.test(val)) {
          // Key
          parts.push(<span key={`key-${match.index}`} className="text-blue">{val.slice(0, -1)}</span>);
          parts.push(<span key={`colon-${match.index}`}>:</span>);
        } else {
          // String
          parts.push(<span key={`str-${match.index}`} className="text-green">{val}</span>);
        }
      } else if (/true|false/.test(val)) {
        parts.push(<span key={`bool-${match.index}`} className="text-purple">{val}</span>);
      } else if (/null/.test(val)) {
        parts.push(<span key={`null-${match.index}`} className="text-muted">{val}</span>);
      } else {
        // Number
        parts.push(<span key={`num-${match.index}`} className="text-orange">{val}</span>);
      }
      
      lastIndex = regex.lastIndex;
    }
    
    if (lastIndex < json.length) {
      parts.push(<span key={`text-${lastIndex}`}>{json.slice(lastIndex)}</span>);
    }
    
    return parts;
  };

  return <>{renderHighlighted()}</>;
}

export function ResponsePanel({ status, data, visible }) {
  if (!visible) return null;
  
  const ok = status >= 200 && status < 300;
  
  return (
    <div className="mt-4 border border-border rounded-lg overflow-hidden block">
      <div className="px-3.5 py-2 flex items-center gap-2.5 text-xs font-mono bg-bg3 border-b border-border">
        <span className={`px-2 py-0.5 rounded font-bold ${ok ? 'bg-[#1c3e2d] text-green' : 'bg-[#3d1c1c] text-red'}`}>
          {status}
        </span>
        <span className="text-muted">{ok ? '✓ Success' : '✗ Error'}</span>
      </div>
      <div className="p-3.5 bg-bg2 font-mono text-xs text-text whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto">
        <SyntaxHighlight obj={data} />
      </div>
    </div>
  );
}

export function Button({ onClick, disabled, loading, variant = 'primary', children, className = '' }) {
  let bgClass = 'bg-blue hover:opacity-85 text-white';
  if (variant === 'success') bgClass = 'bg-green hover:opacity-85 text-white';
  if (variant === 'danger') bgClass = 'bg-red hover:opacity-85 text-white';
  if (variant === 'secondary') bgClass = 'bg-bg3 border border-border text-text hover:bg-bg2';
  if (variant === 'warn') bgClass = 'bg-[#6e4f10] hover:opacity-85 text-[#ffd070]';
  
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 border-none rounded-lg text-[13px] font-semibold cursor-pointer transition-opacity ${bgClass} disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    >
      {loading && <span className="spin">⟳</span>}
      {children}
    </button>
  );
}

export function InfoBox({ type = 'info', children }) {
  let classes = 'bg-bg2 border-border text-text';
  if (type === 'tip') classes = 'bg-[#1c2d4a] border-[#264a8c] text-[#a8c7f0]';
  if (type === 'warn') classes = 'bg-[#2d2210] border-[#6e4f10] text-[#ffd070]';
  if (type === 'danger') classes = 'bg-[#2d1c1c] border-[#6e2020] text-[#f5a0a0]';
  
  return (
    <div className={`p-3.5 rounded-lg border text-[13px] mb-3 ${classes}`}>
      {children}
    </div>
  );
}

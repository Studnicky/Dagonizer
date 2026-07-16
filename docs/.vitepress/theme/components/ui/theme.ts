export type BadgeToneType = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
export type BadgeSizeType = 'sm' | 'md';
export type TerminalStateType = 'pending' | 'completed' | 'failed' | 'cancelled' | 'timed_out';

export function terminalBadgeTone(state: TerminalStateType): BadgeToneType {
  switch (state) {
    case 'completed': return 'success';
    case 'failed': return 'danger';
    case 'cancelled':
    case 'timed_out': return 'warning';
    case 'pending': return 'neutral';
  }
}

export function boolBadgeTone(active: boolean, onTone: BadgeToneType = 'accent', offTone: BadgeToneType = 'neutral'): BadgeToneType {
  return active ? onTone : offTone;
}

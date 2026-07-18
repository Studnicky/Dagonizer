import type { ConversationTurnType } from '../DispatcherState.ts';

interface DispatcherRunnerParkedView {
  readonly cursor: string;
  readonly dagName: string;
}

interface DispatcherRunnerState<TTrace, TParkedExecution> {
  readonly conversation: readonly ConversationTurnType[];
  readonly customerQuery: string;
  readonly isRunning: boolean;
  readonly leftActiveKey: 'customer' | 'operator';
  readonly operatorInput: string;
  readonly parked: DispatcherRunnerParkedView | null;
  readonly parkedExecution: TParkedExecution | null;
  readonly terminalVariant: 'pending' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  readonly trace: readonly TTrace[];
}

export class DispatcherRunnerSetup<TTrace, TParkedExecution> {
  readonly #initialState: DispatcherRunnerState<TTrace, TParkedExecution>;
  readonly #rollbackState: DispatcherRunnerState<TTrace, TParkedExecution>;

  private constructor(
    initialState: DispatcherRunnerState<TTrace, TParkedExecution>,
    rollbackState: DispatcherRunnerState<TTrace, TParkedExecution>,
  ) {
    this.#initialState = initialState;
    this.#rollbackState = rollbackState;
  }

  get initialState(): DispatcherRunnerState<TTrace, TParkedExecution> {
    return this.#initialState;
  }

  rollbackState(): DispatcherRunnerState<TTrace, TParkedExecution> {
    return this.#rollbackState;
  }

  static forDispatch<TTrace, TParkedExecution>(
    snapshot: DispatcherRunnerState<TTrace, TParkedExecution>,
    queryText: string,
    now: number,
  ): DispatcherRunnerSetup<TTrace, TParkedExecution> {
    return new DispatcherRunnerSetup<TTrace, TParkedExecution>(
      {
        ...snapshot,
        'conversation':    [{ 'role': 'customer', 'text': queryText, 'ts': now }],
        'customerQuery':   '',
        'isRunning':       true,
        'leftActiveKey':   'customer',
        'operatorInput':   '',
        'parked':          null,
        'parkedExecution': null,
        'terminalVariant': 'pending',
        'trace':           [],
      },
      snapshot,
    );
  }

  static forResume<TTrace, TParkedExecution>(
    snapshot: DispatcherRunnerState<TTrace, TParkedExecution>,
    operatorTrace: TTrace,
  ): DispatcherRunnerSetup<TTrace, TParkedExecution> {
    return new DispatcherRunnerSetup<TTrace, TParkedExecution>(
      {
        ...snapshot,
        'isRunning':       true,
        'leftActiveKey':   'operator',
        'operatorInput':   '',
        'terminalVariant': 'pending',
        'trace':           [...snapshot.trace, operatorTrace],
      },
      snapshot,
    );
  }
}

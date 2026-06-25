export interface JoinConfig {
  label: string;
  inputs: Array<{
    name: string;
    input: AsyncIterable<unknown> | Iterable<unknown>;
    key: (item: any) => any;
    optional: boolean;
  }>;
  compareKey: (a: any, b: any) => number;
  combine: (bag: Record<string, any>) => any;
  maxGroupSize?: number;
}

export declare function prepare(
  inputs: Record<string, any>,
  options: any,
  label: string,
  optionalFor: (desc: any, index: number) => boolean
): JoinConfig;

export declare function runJoin(config: JoinConfig): AsyncGenerator<any, void, void>;

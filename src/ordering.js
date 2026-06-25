// @ts-self-types="./ordering.d.ts"

export const defaultCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const normalizeComparator = ({compare, lessFn}, label) => {
  if (compare !== undefined && lessFn !== undefined) {
    throw new TypeError(`${label}: pass \`compare\` OR \`lessFn\`, not both`);
  }
  if (compare !== undefined) {
    if (typeof compare !== 'function')
      throw new TypeError(`${label}: \`compare\` must be a function`);
    return {compare, lessFn: (a, b) => compare(a, b) < 0};
  }
  if (lessFn !== undefined) {
    if (typeof lessFn !== 'function')
      throw new TypeError(`${label}: \`lessFn\` must be a function`);
    return {
      lessFn,
      compare: (a, b) => (lessFn(a, b) ? -1 : lessFn(b, a) ? 1 : 0)
    };
  }
  throw new TypeError(`${label}: either \`compare\` or \`lessFn\` is required`);
};

export const validateInput = (input, label) => {
  if (input == null) throw new TypeError(`${label}: input is required`);
  if (input[Symbol.asyncIterator] == null && input[Symbol.iterator] == null) {
    throw new TypeError(`${label}: input must be iterable or async iterable`);
  }
};

export const makeStability = (stable, compare, lessFn) => {
  if (!stable) {
    return {wrap: item => item, unwrap: item => item, runCompare: compare, mergeLess: lessFn};
  }
  let tag = 0;
  return {
    wrap: item => ({item, tag: tag++}),
    unwrap: envelope => envelope.item,
    runCompare: (a, b) => {
      const c = compare(a.item, b.item);
      return c !== 0 ? c : a.tag - b.tag;
    },
    mergeLess: (a, b) => {
      if (lessFn(a.item, b.item)) return true;
      if (lessFn(b.item, a.item)) return false;
      return a.tag < b.tag;
    }
  };
};

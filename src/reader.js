// @ts-self-types="./reader.d.ts"

export const DONE = Symbol('done');

export const makeReader = iterable => {
  const it = iterable[Symbol.asyncIterator]
    ? iterable[Symbol.asyncIterator]()
    : iterable[Symbol.iterator]();
  let buf = DONE;
  let buffered = false;
  const peek = async () => {
    if (!buffered) {
      const r = await it.next();
      buf = r.done ? DONE : r.value;
      buffered = true;
    }
    return buf;
  };
  const take = async () => {
    const v = await peek();
    buffered = false;
    buf = DONE;
    return v;
  };
  const dispose = async () => {
    if (it.return) {
      try {
        await it.return();
      } catch {}
    }
  };
  return {peek, take, dispose};
};

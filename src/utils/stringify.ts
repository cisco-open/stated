export const circularReplacer = (key: any, value: any) => {
  if (value === undefined) {
    return null;
  }
  if (value?._jsonata_lambda || value?._stated_function__) {
    return "{function:}";
  }
  if (key === 'compiledExpr__') {
    return "--compiled expression--";
  }
  if (null !== value) {
    const { _idleTimeout, _onTimeout } = value;
    if (_idleTimeout !== undefined && _onTimeout !== undefined) {
      return "--interval/timeout--";
    }
    if (value instanceof Set) {
      return Array.from(value);
    }
  }
  return value;
}

export const stringifyTemplateJSON = (o: any, printFunction = circularReplacer) => {
  return JSON.stringify(o, printFunction, 2);
}
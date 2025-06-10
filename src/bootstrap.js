const originalEmit = process.emit;
process.emit = function (name, data, ...args) {
  if (
    name === "warning" &&
    typeof data === "object" &&
    data.name === "DeprecationWarning" &&
    data.code === "DEP0040" // Specifieke code voor punycode
  ) {
    return false;
  }
  return originalEmit.apply(process, arguments);
};

// Daily Challenge release switches. Repeated-entry testing must use an
// explicit local fixture; checked-in builds always enforce the real limit.
module.exports = {
  entryLimit: 3,
  timeZone: 'Asia/Shanghai',
  debugUnlimitedEntries: false
};

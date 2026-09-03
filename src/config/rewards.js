'use strict';

module.exports = {
  schemaVersion: 1,
  currency: {
    ordinaryFirstClear: 100,
    dailyFirstComplete: 500
  },
  items: [
    { id: 'theme:classic', kind: 'theme', itemId: 'classic', unlock: { type: 'default' } },
    { id: 'theme:gem', kind: 'theme', itemId: 'gem', unlock: { type: 'ordinary_level', levelKey: '1:2' } },
    { id: 'theme:fruits', kind: 'theme', itemId: 'fruits', unlock: { type: 'ordinary_level', levelKey: '3:7' } },
    { id: 'theme:animals', kind: 'theme', itemId: 'animals', unlock: { type: 'ordinary_level', levelKey: '4:55' } },
    { id: 'theme:desserts', kind: 'theme', itemId: 'desserts', unlock: { type: 'currency', cost: 10000 } },
    { id: 'theme:space', kind: 'theme', itemId: 'space', unlock: { type: 'currency', cost: 10000 } },
    { id: 'theme:ocean', kind: 'theme', itemId: 'ocean', unlock: { type: 'rewarded_ad', requiredCount: 1 } },
    { id: 'theme:spring', kind: 'theme', itemId: 'spring', unlock: { type: 'rewarded_ad', requiredCount: 1 } },
    { id: 'theme:music', kind: 'theme', itemId: 'music', unlock: { type: 'rewarded_ad', requiredCount: 1 } },
    { id: 'theme:vehicles', kind: 'theme', itemId: 'vehicles', unlock: { type: 'rewarded_ad', requiredCount: 1 } },
    { id: 'theme:festival', kind: 'theme', itemId: 'festival', unlock: { type: 'share' } },
    { id: 'effect:none', kind: 'effect', itemId: 'none', unlock: { type: 'default' } },
    { id: 'effect:fade', kind: 'effect', itemId: 'fade', unlock: { type: 'ordinary_level', levelKey: '2:2' } }
  ]
};

'use strict';

// Portal-aware answers are intentionally separate from data/solutions.js:
// every line is an ordered list of contiguous segments, with an explicit
// release-and-reconnect edge between the segment ending at A and the segment
// beginning at B.  Cells inside a segment are ordinary four-neighbour moves;
// A -> B is never treated as an adjacent board step.
module.exports = {
  ByLevelId: {
    'portal-demo-01': [
      {
        Segments: [
          {
            Cells: [0, 1, 6, 5, 10, 11, 16, 15, 20, 21],
            Exit: { PairId: 'P1', From: 21, To: 2 }
          },
          { Cells: [2, 3, 4, 9, 8, 7, 12, 13, 14, 19, 18, 17, 22, 23, 24] }
        ]
      }
    ],
    'portal-demo-02': [
      {
        Segments: [
          {
            Cells: [0, 1, 7, 6, 12, 13],
            Exit: { PairId: 'P1', From: 13, To: 2 }
          },
          { Cells: [2, 3, 4, 5, 11, 10, 9, 8, 14, 15, 16, 17] }
        ]
      },
      {
        Segments: [
          { Cells: [18, 19, 20, 21, 22, 23, 29, 28, 27, 26, 25, 24, 30, 31, 32, 33, 34, 35] }
        ]
      }
    ],
    'portal-demo-03': [
      {
        Segments: [
          {
            Cells: [0, 1, 2, 3, 4, 5, 11, 10, 9, 8, 7, 6],
            Exit: { PairId: 'P1', From: 6, To: 30 }
          },
          { Cells: [30, 31, 32, 33, 34, 35] }
        ]
      },
      {
        Segments: [
          { Cells: [13, 12, 18, 19, 20, 14, 15, 16, 17, 23, 29, 28, 22, 21, 27, 26, 25, 24] }
        ]
      }
    ],
    'portal-demo-04': [
      {
        Segments: [
          {
            Cells: [0, 1, 2, 3, 4, 5],
            Exit: { PairId: 'P1', From: 5, To: 14 }
          },
          { Cells: [14, 15, 16, 17, 23, 22, 21, 20, 26, 32, 33, 27, 28, 29, 35, 34] }
        ]
      },
      {
        Segments: [
          { Cells: [11, 10, 9, 8, 7, 6, 12, 18, 24, 30, 31, 25, 19, 13] }
        ]
      }
    ],
    'portal-demo-05': [
      {
        Segments: [
          {
            Cells: [0, 1, 2, 3, 4, 5, 11, 10, 9, 8, 7, 6],
            Exit: { PairId: 'P1', From: 6, To: 30 }
          },
          { Cells: [30, 31, 32, 33, 34, 35] }
        ]
      },
      {
        Segments: [
          { Cells: [12, 13, 19, 18, 24, 25, 26, 27, 28, 29, 23, 17, 16, 22, 21, 15] }
        ]
      }
    ]
  }
};

'use strict';

// Stand-alone trial set for the v2 portal gameplay extension. It deliberately
// stays outside the ordinary catalog so trial clears cannot unlock or overwrite
// normal progression. Each game carries a stable Id so portal-solutions.js can
// be consumed independently by HintService and publishing validation.
module.exports = {
  Name: 'Portal Trials',
  Color: '#00ABA9',
  Palette: ['#ff1d23', '#0A71c7', '#96ca2d', '#f0ca4d'],
  Games: [
    {
      Id: 'portal-demo-01',
      Name: '入门：到门后继续',
      Mechanic: 'portal',
      PortalRulesVersion: 2,
      Width: 5,
      Height: 5,
      Lines: [{ Start: 0, End: 24 }],
      Portals: [{ Id: 'P1', Cells: [21, 2] }],
      Instructions: '到达传送门后松手，再从另一扇门继续'
    },
    {
      Id: 'portal-demo-02',
      Name: '捷径：跨区连线',
      Mechanic: 'portal',
      PortalRulesVersion: 2,
      Width: 6,
      Height: 6,
      Lines: [
        { Start: 0, End: 17 },
        { Start: 18, End: 35 }
      ],
      Portals: [{ Id: 'P1', Cells: [13, 2] }],
      Instructions: '传送门会把同一条线路带到棋盘另一侧'
    },
    {
      Id: 'portal-demo-03',
      Name: '出口：靠近另一条线',
      Mechanic: 'portal',
      PortalRulesVersion: 2,
      Width: 6,
      Height: 6,
      Lines: [
        { Start: 0, End: 35 },
        { Start: 13, End: 24 }
      ],
      // Cell 30 sits immediately above the lower edge of line 2's route. It is
      // still owned by line 1 in the solution; do not assign it to line 2.
      Portals: [{ Id: 'P1', Cells: [6, 30] }],
      Instructions: '先确认可用出口，再安排另一条线路'
    },
    {
      Id: 'portal-demo-04',
      Name: '重连：按错即可再试',
      Mechanic: 'portal',
      PortalRulesVersion: 2,
      Width: 6,
      Height: 6,
      Lines: [
        { Start: 0, End: 34 },
        { Start: 11, End: 13 }
      ],
      // The ordinary endpoint 13 is adjacent to portal cell 14 and is an intentional
      // wrong-tap distractor for testing the non-penalty rollback flow.
      Portals: [{ Id: 'P1', Cells: [5, 14] }],
      Instructions: '按错位置不会失败，只需松手后重新连接'
    },
    {
      Id: 'portal-demo-05',
      Name: '覆盖：避开阻挡格',
      Mechanic: 'portal',
      PortalRulesVersion: 2,
      Width: 6,
      Height: 6,
      Blocked: [14, 20],
      Lines: [
        { Start: 0, End: 35 },
        { Start: 12, End: 15 }
      ],
      Portals: [{ Id: 'P1', Cells: [6, 30] }],
      Instructions: '避开灰色阻挡格并完成所有线路'
    }
  ]
};

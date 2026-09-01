// "No effect" is still a declarative gallery entry. Keep it free of runtime
// callbacks so the app can use its type to skip the animation snapshot.
module.exports = {
  id: 'none',
  name: '无特效',
  type: 'none',
  preview: 'assets/effects/none/preview.png',
  durationMs: 0,
  params: {}
};

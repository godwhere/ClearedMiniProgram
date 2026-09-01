const tests = [
  ['architecture boundaries', require('./architecture-boundaries.test.js')],
  ['game runner', require('./game-runner.test.js')],
  ['game runner contract', require('./game-runner-contract.test.js')],
  ['run context and completion policies', require('./run-context.test.js')],
  ['progress store', require('./progress-store.test.js')],
  ['clear effect service', require('./clear-effect-service.test.js')],
  ['clear effect system', require('./clear-effect-system.test.js')],
  ['canvas renderer', require('./renderer.test.js')],
  ['interaction map', require('./interaction-map.test.js')],
  ['board input controller', require('./board-input-controller.test.js')],
  ['mini game app smoke', require('./app-smoke.test.js')],
  ['ads service', require('./ads-service.test.js')],
  ['skin service', require('./skin-service.test.js')],
  ['WeChat project config', require('./project-config.test.js')],
  ['compiled level modules', require('./level-modules.test.js')],
  ['progression service', require('./progression-service.test.js')],
  ['developer tools runtime gate', require('./devtools-runtime.test.js')],
  ['audio service', require('./audio-service.test.js')],
  ['hint service', require('./hint-service.test.js')],
  ['solutions', require('./solutions.test.js')],
  ['theme system', require('./theme-system.test.js')],
  ['theme assets', require('./theme-assets.test.js')],
  ['daily challenge service', require('./daily-challenge-service.test.js')],
  ['daily progress store', require('./daily-progress-store.test.js')],
  ['daily app flow', require('./daily-app.test.js')],
  ['portal validation', require('./portal-validation.test.js')],
  ['game runner portals', require('./game-runner-portal.test.js')],
  ['hint service portals', require('./hint-service-portal.test.js')],
  ['app portals', require('./app-portal.test.js')],
  ['renderer portals', require('./renderer-portal.test.js')],
  ['gameplay mechanics', require('./mechanics.test.js')],
  ['portal publishing gate', require('./portal-publishing.test.js')]
];

async function main() {
  let failed = 0;
  for (const [name, test] of tests) {
    try {
      await test();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${name}`);
      console.error(error.stack || error);
    }
  }
  if (failed) process.exit(1);
}

main();

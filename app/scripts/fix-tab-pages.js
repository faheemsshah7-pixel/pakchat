// fix-tab-pages.js: runs after npm install. Makes switching between the tabs instant.
// Safe to run again: the change is only made once.
//
// The tabs (Chats, Status, Communities, Calls) sit side by side in a pager. On Android
// that pager only keeps the tab next to the one showing ready; a tab further away
// (Chats to Calls) is only put on screen when it's tapped, so its contents came in
// late about half the time. The tab view has no setting for this, so here it tells
// the pager to keep every tab ready.
const fs = require('fs');
const path = require('path');

// eslint-disable-next-line no-undef
const dir = path.join(__dirname, '..', 'node_modules', 'react-native-tab-view');
const mark = 'pakchat: keep every tab ready';
const files = [
  ['lib/module/PagerViewAdapter.js', '_jsx(AnimatedViewPager, {\n      ...rest,\n', `_jsx(AnimatedViewPager, {\n      ...rest,\n      // ${mark}\n      offscreenPageLimit: Math.max(1, navigationState.routes.length - 1),\n`],
  ['src/PagerViewAdapter.tsx', '<AnimatedViewPager\n        {...rest}\n', `<AnimatedViewPager\n        {...rest}\n        // ${mark}\n        offscreenPageLimit={Math.max(1, navigationState.routes.length - 1)}\n`],
];

for (const [name, from, to] of files) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) continue;
  const js = fs.readFileSync(file, 'utf8');
  if (js.includes(mark)) continue;
  if (js.split(from).length === 2) {
    fs.writeFileSync(file, js.replace(from, to));
    console.log(`fix-tab-pages: every tab stays ready (${name})`);
  } else {
    console.warn(`fix-tab-pages: react-native-tab-view has changed (${name}); check switching tabs before building.`);
  }
}

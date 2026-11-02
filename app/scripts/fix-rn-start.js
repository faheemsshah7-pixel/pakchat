// fix-rn-start.js: runs after npm install. Makes PakChat open faster on slower phones.
// Safe to run again: the change is only made once.
//
// React Native builds its UIManager by copying another object with `...`, and that
// copy reads every property. About fifty of those properties are lazy: reading one
// makes Android set up that kind of view (every SVG shape, switches, drawers, pull
// to refresh, and so on) and describe all its settings. So on every start Android
// set up every kind of view the app could ever use, before showing anything.
// Here the copy takes the properties as they are, without reading them, so each
// kind of view is only set up the first time a screen really uses it.
const fs = require('fs');
const path = require('path');

// eslint-disable-next-line no-undef
const file = path.join(__dirname, '..', 'node_modules', 'react-native', 'Libraries', 'ReactNative', 'UIManager.js');
const mark = '// pakchat: copy without reading';

if (fs.existsSync(file)) {
  const js = fs.readFileSync(file, 'utf8');
  if (!js.includes(mark)) {
    const head = 'const UIManager: UIManagerJSInterface = {\n  ...UIManagerImpl,\n';
    const tail = '\n};\n\nexport default UIManager;\n';
    if (js.split(head).length === 2 && js.endsWith(tail)) {
      const after =
        js
          .replace(
            head,
            'const UIManager: UIManagerJSInterface = Object.assign(\n' +
              `  ${mark} (keeps each view's set-up lazy)\n` +
              '  Object.defineProperties({}, Object.getOwnPropertyDescriptors(UIManagerImpl)),\n' +
              '  {\n',
          )
          .slice(0, -tail.length) + '\n  },\n);\n\nexport default UIManager;\n';
      fs.writeFileSync(file, after);
      console.log('fix-rn-start: UIManager no longer sets up every view at start');
    } else {
      console.warn('fix-rn-start: react-native has changed (UIManager.js); check start-up before building.');
    }
  }
}

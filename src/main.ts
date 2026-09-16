/**
 * The only file that touches the `logseq` global. Everything it wires up is
 * in `plugin.ts`, which is tested against a fake host.
 */
import '@logseq/libs';
import { blockOps } from './graph';
import { startPlugin } from './plugin';
import settings from './settings';

logseq
  .useSettingsSchema(settings)
  .ready(() =>
    startPlugin({
      settings: () => logseq.settings,
      ops: () => blockOps(logseq.App, logseq.Editor),
      ui: {
        showMsg: (message, status, opts) => logseq.UI.showMsg(message, status, opts),
        closeMsg: (key) => logseq.UI.closeMsg(key),
      },
      registerSlashCommand: (name, run) => {
        logseq.Editor.registerSlashCommand(name, ({ uuid }) => run(uuid));
      },
      onSettingsChanged: (callback) => {
        logseq.onSettingsChanged(callback);
      },
      log: console,
    }),
  )
  .catch(console.error);

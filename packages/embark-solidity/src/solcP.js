import { ProcessWrapper } from 'embark-core';
const fs = require('fs-extra');
const semver = require('semver');
const PluginManager = require('live-plugin-manager-git-fix').PluginManager;
import { LongRunningProcessTimer } from 'embark-utils';

class SolcProcess extends ProcessWrapper {

  constructor(options) {
    super({pingParent: false});
    this._logger = options.logger;
    this._showSpinner = options.showSpinner === true;
    this._providerUrl = options.providerUrl;
  }

  findImports(filename) {
    if (fs.existsSync(filename)) {
      return {contents: fs.readFileSync(filename).toString()};
    }
    return {error: 'File not found'};
  }

  installAndLoadCompiler(solcVersion, packagePath) {
    let self = this;
    return new Promise((resolve, reject) => {
      let manager = new PluginManager({pluginsPath: packagePath});
      let timer;
      if (!fs.existsSync(packagePath)) {
        timer = new LongRunningProcessTimer(
          self._logger,
          'solc',
          solcVersion,
          'Downloading and installing {{packageName}} {{version}}...',
          'Still downloading and installing {{packageName}} {{version}}... ({{duration}})',
          'Finished downloading and installing {{packageName}} {{version}} in {{duration}}',
          { showSpinner: self._showSpinner }
        );
      }

      if (timer) timer.start();
      manager.install('solc', solcVersion).then(() => {
        self.solc = manager.require('solc');
        if (timer) timer.end();
        resolve();
      }).catch(reject);

    });
  }

  compile(jsonObj, cb) {
    // TODO: only available in 0.4.11; need to make versions warn about this
    try {
      let func = this.solc.compileStandardWrapper;
      if (semver.gte(this.solc.version(), '0.5.0')) {
        func = this.solc.compile;
      }
      let output = func(JSON.stringify(jsonObj), this.findImports.bind(this));
      cb(null, output);
    } catch (err) {
      cb(err.message || err);
    }
  }


}

let solcProcess;
process.on('message', (msg) => {
  if (msg.action === "init") {
    msg.options.logger = console;
    solcProcess = new SolcProcess(msg.options);
    return process.send({result: "initiated"});
  }

  else if (msg.action === 'loadCompiler') {
    solcProcess.solc = require('solc');
    return process.send({result: "loadedCompiler"});
  }

  else if (msg.action === 'installAndLoadCompiler') {
    solcProcess.installAndLoadCompiler(msg.solcVersion, msg.packagePath).then(() => {
      return process.send({result: "loadedCompiler"});
    });
  }

  else if (msg.action === 'compile') {
    solcProcess.compile(msg.jsonObj, (err, output) => {
      process.send({result: "compilation-" + msg.id, err: err, output: output});
    });
  }
});

/* global parserlib CSSLint mozParser */
'use strict';

self.importScripts('./parserlib.js');
parserlib.css.Tokens[parserlib.css.Tokens.COMMENT].hide = false;

self.onmessage = ({data: {action = 'run', code, config}}) => {

  if (!self.CSSLint && action !== 'parse') {
    self.importScripts('./csslint.js');
  }

  switch (action) {
    case 'getAllRuleIds':
      // the functions are non-tranferable and we need only an id
      self.postMessage(CSSLint.getRules().map(rule => rule.id));
      return;

    case 'getAllRuleInfos':
      // the functions are non-tranferable
      self.postMessage(CSSLint.getRules().map(rule => JSON.parse(JSON.stringify(rule))));
      return;

    case 'run': {
      const results = CSSLint.verify(code, config).messages
        .filter(m => !m.message.includes('/*[[') && !m.message.includes(']]*/'))
        .map(m => Object.assign(m, {rule: {id: m.rule.id}}));
      self.postMessage(results);
      return;
    }
    case 'parse':
      if (!self.mozParser) self.importScripts('/js/moz-parser.js');
      mozParser.parse(code)
        .then(sections => self.postMessage(sections))
        .catch(info => self.postMessage({__ERROR__: info}));
  }
};

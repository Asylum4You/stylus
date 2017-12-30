/*
Modded by tophf <github.com/tophf>
========== Original disclaimer:

Copyright (c) 2016 Nicole Sullivan and Nicholas C. Zakas. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the 'Software'), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

/* global parserlib */
'use strict';

//region Reporter

class Reporter {
  /**
   * An instance of Report is used to report results of the
   * verification back to the main API.
   * @class Reporter
   * @constructor
   * @param {String[]} lines The text lines of the source.
   * @param {Object} ruleset The set of rules to work with, including if
   *      they are errors or warnings.
   * @param {Object} explicitly allowed lines
   * @param {[][]} ingore list of line ranges to be ignored
   */
  constructor(lines, ruleset, allow, ignore) {
    this.messages = [];
    this.stats = [];
    this.lines = lines;
    this.ruleset = ruleset;
    this.allow = allow || {};
    this.ignore = ignore || [];
  }

  error(message, line, col, rule = {}) {
    this.messages.push({
      type: 'error',
      evidence: this.lines[line - 1],
      line, col,
      message,
      rule,
    });
  }

  report(message, line, col, rule) {
    if (line in this.allow && rule.id in this.allow[line] ||
        this.ignore.some(range => range[0] <= line && line <= range[1])) {
      return;
    }
    this.messages.push({
      type: this.ruleset[rule.id] === 2 ? 'error' : 'warning',
      evidence: this.lines[line - 1],
      line, col,
      message,
      rule,
    });
  }

  info(message, line, col, rule) {
    this.messages.push({
      type: 'info',
      evidence: this.lines[line - 1],
      line, col,
      message,
      rule,
    });
  }

  rollupError(message, rule) {
    this.messages.push({
      type: 'error',
      rollup: true,
      message,
      rule,
    });
  }

  rollupWarn(message, rule) {
    this.messages.push({
      type: 'warning',
      rollup: true,
      message,
      rule,
    });
  }

  stat(name, value) {
    this.stats[name] = value;
  }
}

//endregion
//region CSSLint

//eslint-disable-next-line no-var
var CSSLint = (() => {

  const RX_EMBEDDED = /\/\*\s*csslint\s+((?:[^*]|\*(?!\/))+?)\*\//igu;
  const EBMEDDED_RULE_VALUE_MAP = {
    // error
    'true':  2,
    '2':     2,
    // warning
    '':      1,
    '1':     1,
    // ignore
    'false': 0,
    '0':     0,
  };
  const rules = [];

  return Object.assign(new parserlib.util.EventTarget(), {

    addRule(rule) {
      rules.push(rule);
      rules[rule.id] = rule;
    },

    clearRules() {
      rules.length = 0;
    },

    getRules() {
      return rules
        .slice()
        .sort((a, b) =>
          a.id < b.id ? -1 :
          a.id > b.id ? 1 : 0);
    },

    getRuleset() {
      const ruleset = {};
      // by default, everything is a warning
      for (const rule of rules) {
        ruleset[rule.id] = 1;
      }
      return ruleset;
    },

    /**
     * Starts the verification process for the given CSS text.
     * @param {String} text The CSS text to verify.
     * @param {Object} ruleset (Optional) List of rules to apply. If null, then
     *      all rules are used. If a rule has a value of 1 then it's a warning,
     *      a value of 2 means it's an error.
     * @return {Object} Results of the verification.
     */
    verify(text, ruleset) {

      if (!ruleset) ruleset = this.getRuleset();

      const allow = {};
      const ignore = [];
      RX_EMBEDDED.lastIndex =
        text.lastIndexOf('/*',
          text.indexOf('csslint',
            text.indexOf('/*') + 1 || text.length) + 1);
      if (RX_EMBEDDED.lastIndex >= 0) {
        ruleset = Object.assign({}, ruleset);
        applyEmbeddedOverrides(text, ruleset, allow, ignore);
      }

      const parser = new parserlib.css.Parser({
        starHack:       true,
        ieFilters:      true,
        underscoreHack: true,
        strict:         false,
      });

      const reporter = new Reporter([], ruleset, allow, ignore);

      // always report parsing errors as errors
      ruleset.errors = 2;
      Object.keys(ruleset).forEach(id =>
        ruleset[id] &&
        rules[id] &&
        rules[id].init(parser, reporter));

      try {
        parser.parse(text/*, {reuseCache: true}*/);
      } catch (ex) {
        reporter.error('Fatal error, cannot continue: ' + ex.message, ex.line, ex.col, {});
      }

      const report = {
        messages: reporter.messages,
        stats:    reporter.stats,
        ruleset:  reporter.ruleset,
        allow:    reporter.allow,
        ignore:   reporter.ignore,
      };

      // sort by line numbers, rollups at the bottom
      report.messages.sort((a, b) =>
        a.rollup && !b.rollup ? 1 :
        !a.rollup && b.rollup ? -1 :
        a.line - b.line);

      //parserlib.cache.feedback(report);

      return report;
    },
  });

  function applyEmbeddedOverrides(text, ruleset, allow, ignore) {
    let ignoreStart = null;
    let ignoreEnd = null;
    let lineno = 0;

    for (let eol = 0, m; (m = RX_EMBEDDED.exec(text)); lineno++) {
      eol = (text.indexOf('\n', eol) + 1 || text.length + 1) - 1;
      if (eol < m.index) continue;

      const ovr = m[1].toLowerCase();
      const cmd = ovr.split(':', 1);
      const i = cmd.length + 1;

      switch (cmd.trim()) {

        case 'allow': {
          const allowRuleset = {};
          let num = 0;
          ovr.slice(i).split(',').forEach(allowRule => {
            allowRuleset[allowRule.trim()] = true;
            num++;
          });
          if (num) allow[lineno + 1] = allowRuleset;
          break;
        }

        case 'ignore':
          if (ovr.lastIndexOf('start', i) > 0) {
            if (ignoreStart === null) ignoreStart = lineno;
            break;
          }
          if (ovr.lastIndexOf('end', i) > 0) {
            ignoreEnd = lineno;
            if (ignoreStart !== null && ignoreEnd !== null) {
              ignore.push([ignoreStart, ignoreEnd]);
              ignoreStart = ignoreEnd = null;
            }
          }
          break;

        default:
          ovr.slice(i).split(',').forEach(rule => {
            const pair = rule.split(':');
            const property = pair[0] || '';
            const value = pair[1] || '';
            const mapped = EBMEDDED_RULE_VALUE_MAP[value.trim()];
            ruleset[property.trim()] = mapped === undefined ? 1 : mapped;
          });
      }
    }

    // Close remaining ignore block, if any
    if (ignoreStart !== null) {
      ignore.push([ignoreStart, lineno]);
    }
  }
})();

//endregion
//region Util

// expose for testing purposes
CSSLint._Reporter = Reporter;

CSSLint.Util = {
  indexOf(values, value) {
    if (typeof values.indexOf === 'function') {
      return values.indexOf(value);
    }
    for (let i = 0, len = values.length; i < len; i++) {
      if (values[i] === value) {
        return i;
      }
    }
    return -1;
  },
};

//endregion
//region Rules

CSSLint.addRule({
  id:       'adjoining-classes',
  name:     'Disallow adjoining classes',
  desc:     "Don't use adjoining classes.",
  url:      'https://github.com/CSSLint/csslint/wiki/Disallow-adjoining-classes',
  browsers: 'IE6',

  init(parser, reporter) {
    const rule = this;
    parser.addListener('startrule', event => {
      for (const selector of event.selectors) {
        for (const part of selector.parts) {
          if (part.type !== parser.SELECTOR_PART_TYPE) continue;
          let classCount = 0;
          for (const modifier of part.modifiers) {
            classCount += modifier.type === 'class';
            if (classCount > 1) {
              reporter.report('Adjoining classes: ' + selector.text, part.line, part.col, rule);
            }
          }
        }
      }
    });
  },
});

CSSLint.addRule({
  id:       'box-model',
  name:     'Beware of broken box size',
  desc:     "Don't use width or height when using padding or border.",
  url:      'https://github.com/CSSLint/csslint/wiki/Beware-of-box-model-size',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    const sizeProps = {
      width: [
        'border',
        'border-left',
        'border-right',
        'padding',
        'padding-left',
        'padding-right',
      ],
      height: [
        'border',
        'border-bottom',
        'border-top',
        'padding',
        'padding-bottom',
        'padding-top',
      ],
    };
    let properties;
    let boxSizing = false;

    function startRule() {
      properties = {};
      boxSizing = false;
    }

    function endRule() {
      if (boxSizing) return;
      for (const size in sizeProps) {
        if (!properties[size]) continue;
        for (const prop in sizeProps[size]) {
          if (prop !== 'padding' || !properties[prop]) continue;
          const {value, line, col} = properties[prop].value;
          if (value.parts.length !== 2 || Number(value.parts[0].value) !== 0) {
            reporter.report(`Using ${size} with ${prop} can sometimes make elements larger than you expect.`,
              line, col, rule);
          }
        }
      }
    }

    parser.addListener('startrule', startRule);
    parser.addListener('startfontface', startRule);
    parser.addListener('startpage', startRule);
    parser.addListener('startpagemargin', startRule);
    parser.addListener('startkeyframerule', startRule);
    parser.addListener('startviewport', startRule);

    parser.addListener('property', event => {
      const name = event.property.text.toLowerCase();

      if (sizeProps.width[name] || sizeProps.height[name]) {
        if (!/^0+\D*$/.test(event.value) &&
            (name !== 'border' || !/^none$/i.test(event.value))) {
          properties[name] = {
            line: event.property.line,
            col: event.property.col,
            value: event.value,
          };
        }
      } else if (/^(width|height)/i.test(name) &&
                 /^(length|percentage)/.test(event.value.parts[0].type)) {
        properties[name] = 1;
      } else if (name === 'box-sizing') {
        boxSizing = true;
      }
    });

    parser.addListener('endrule', endRule);
    parser.addListener('endfontface', endRule);
    parser.addListener('endpage', endRule);
    parser.addListener('endpagemargin', endRule);
    parser.addListener('endkeyframerule', endRule);
    parser.addListener('endviewport', endRule);
  },
});

CSSLint.addRule({
  id:       'box-sizing',
  name:     'Disallow use of box-sizing',
  desc:     "The box-sizing properties isn't supported in IE6 and IE7.",
  url:      'https://github.com/CSSLint/csslint/wiki/Disallow-box-sizing',
  browsers: 'IE6, IE7',
  tags:     ['Compatibility'],

  init(parser, reporter) {
    const rule = this;
    parser.addListener('property', event => {
      if (event.property.text.toLowerCase() === 'box-sizing') {
        reporter.report(rule.desc, event.line, event.col, rule);
      }
    });
  },
});

CSSLint.addRule({
  id:       'bulletproof-font-face',
  name:     'Use the bulletproof @font-face syntax',
  desc:     'Use the bulletproof @font-face syntax to avoid 404\'s in old IE ' +
            '(http://www.fontspring.com/blog/the-new-bulletproof-font-face-syntax).',
  url:      'https://github.com/CSSLint/csslint/wiki/Bulletproof-font-face',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    let fontFaceRule = false;
    let firstSrc = true;
    let ruleFailed = false;
    let line, col;

    // Mark the start of a @font-face declaration so we only test properties inside it
    parser.addListener('startfontface', () => {
      fontFaceRule = true;
    });

    parser.addListener('property', event => {
      // If we aren't inside an @font-face declaration then just return
      if (!fontFaceRule) return;

      const propertyName = event.property.toString().toLowerCase();
      const value = event.value.toString();

      // Set the line and col numbers for use in the endfontface listener
      line = event.line;
      col = event.col;

      // This is the property that we care about, we can ignore the rest
      if (propertyName === 'src') {
        const regex = /^\s?url\(['"].+\.eot\?.*['"]\)\s*format\(['"]embedded-opentype['"]\).*$/i;

        // We need to handle the advanced syntax with two src properties
        if (!value.match(regex) && firstSrc) {
          ruleFailed = true;
          firstSrc = false;

        } else if (value.match(regex) && !firstSrc) {
          ruleFailed = false;
        }
      }
    });

    // Back to normal rules that we don't need to test
    parser.addListener('endfontface', () => {
      fontFaceRule = false;
      if (ruleFailed) {
        reporter.report("@font-face declaration doesn't follow the fontspring bulletproof syntax.",
          line, col, rule);
      }
    });
  },
});

CSSLint.addRule({
  id:       'compatible-vendor-prefixes',
  name:     'Require compatible vendor prefixes',
  desc:     'Include all compatible vendor prefixes to reach a wider range of users.',
  url:      'https://github.com/CSSLint/csslint/wiki/Require-compatible-vendor-prefixes',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    const applyTo = [];
    let properties;
    let inKeyFrame = false;

    // See http://peter.sh/experiments/vendor-prefixed-css-property-overview/ for details
    const compatiblePrefixes = {
      'animation':                  'webkit',
      'animation-delay':            'webkit',
      'animation-direction':        'webkit',
      'animation-duration':         'webkit',
      'animation-fill-mode':        'webkit',
      'animation-iteration-count':  'webkit',
      'animation-name':             'webkit',
      'animation-play-state':       'webkit',
      'animation-timing-function':  'webkit',
      'appearance':                 'webkit moz',
      'border-end':                 'webkit moz',
      'border-end-color':           'webkit moz',
      'border-end-style':           'webkit moz',
      'border-end-width':           'webkit moz',
      'border-image':               'webkit moz o',
      'border-radius':              'webkit',
      'border-start':               'webkit moz',
      'border-start-color':         'webkit moz',
      'border-start-style':         'webkit moz',
      'border-start-width':         'webkit moz',
      'box-align':                  'webkit moz',
      'box-direction':              'webkit moz',
      'box-flex':                   'webkit moz',
      'box-lines':                  'webkit',
      'box-ordinal-group':          'webkit moz',
      'box-orient':                 'webkit moz',
      'box-pack':                   'webkit moz',
      'box-sizing':                 '',
      'box-shadow':                 '',
      'column-count':               'webkit moz ms',
      'column-gap':                 'webkit moz ms',
      'column-rule':                'webkit moz ms',
      'column-rule-color':          'webkit moz ms',
      'column-rule-style':          'webkit moz ms',
      'column-rule-width':          'webkit moz ms',
      'column-width':               'webkit moz ms',
      'flex':                       'webkit ms',
      'flex-basis':                 'webkit',
      'flex-direction':             'webkit ms',
      'flex-flow':                  'webkit',
      'flex-grow':                  'webkit',
      'flex-shrink':                'webkit',
      'hyphens':                    'epub moz',
      'line-break':                 'webkit ms',
      'margin-end':                 'webkit moz',
      'margin-start':               'webkit moz',
      'marquee-speed':              'webkit wap',
      'marquee-style':              'webkit wap',
      'padding-end':                'webkit moz',
      'padding-start':              'webkit moz',
      'tab-size':                   'moz o',
      'text-size-adjust':           'webkit ms',
      'transform':                  'webkit ms',
      'transform-origin':           'webkit ms',
      'transition':                 '',
      'transition-delay':           '',
      'transition-duration':        '',
      'transition-property':        '',
      'transition-timing-function': '',
      'user-modify':                'webkit moz',
      'user-select':                'webkit moz ms',
      'word-break':                 'epub ms',
      'writing-mode':               'epub ms',
    };

    for (const prop in compatiblePrefixes) {
      const variations = compatiblePrefixes[prop].split(' ').map(s => `-${s}-${prop}`);
      compatiblePrefixes[prop] = variations;
      applyTo.push(...variations);
    }

    parser.addListener('startrule', () => {
      properties = [];
    });

    parser.addListener('startkeyframes', event => {
      inKeyFrame = event.prefix || true;
    });

    parser.addListener('endkeyframes', () => {
      inKeyFrame = false;
    });

    parser.addListener('property', event => {
      const name = event.property;
      if (CSSLint.Util.indexOf(applyTo, name.text) > -1) {
        // e.g., -moz-transform is okay to be alone in @-moz-keyframes
        if (!inKeyFrame ||
            typeof inKeyFrame !== 'string' ||
            name.text.indexOf('-' + inKeyFrame + '-') !== 0) {
          properties.push(name);
        }
      }
    });

    parser.addListener('endrule', () => {
      if (!properties.length) return;

      const propertyGroups = {};

      for (const name of properties) {
        for (const prop in compatiblePrefixes) {
          const variations = compatiblePrefixes[prop];
          if (CSSLint.Util.indexOf(variations, name.text) <= -1) continue;
          if (!propertyGroups[prop]) {
            propertyGroups[prop] = {
              full: variations.slice(0),
              actual: [],
              actualNodes: [],
            };
          }
          if (CSSLint.Util.indexOf(propertyGroups[prop].actual, name.text) === -1) {
            propertyGroups[prop].actual.push(name.text);
            propertyGroups[prop].actualNodes.push(name);
          }
        }
      }

      for (const prop in propertyGroups) {
        const value = propertyGroups[prop];
        const full = value.full;
        const actual = value.actual;
        if (full.length <= actual.length) continue;
        for (let i = 0, len = full.length; i < len; i++) {
          const item = full[i];
          if (CSSLint.Util.indexOf(actual, item) !== -1) continue;
          const propertiesSpecified =
            actual.length === 1 ?
              actual[0] :
              actual.length === 2 ?
                actual.join(' and ') :
                actual.join(', ');
          const {line, col} = value.actualNodes[0];
          reporter.report(
            `The property ${item} is compatible with ${propertiesSpecified} and should be included as well.`,
            line, col, rule);
        }
      }
    });
  },
});

CSSLint.addRule({
  id:       'display-property-grouping',
  name:     'Require properties appropriate for display',
  desc:     "Certain properties shouldn't be used with certain display property values.",
  url:      'https://github.com/CSSLint/csslint/wiki/Require-properties-appropriate-for-display',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    const propertiesToCheck = {
      'display':        1,
      'float':          'none',
      'height':         1,
      'width':          1,
      'margin':         1,
      'margin-left':    1,
      'margin-right':   1,
      'margin-bottom':  1,
      'margin-top':     1,
      'padding':        1,
      'padding-left':   1,
      'padding-right':  1,
      'padding-bottom': 1,
      'padding-top':    1,
      'vertical-align': 1,
    };
    let properties;

    function reportProperty(name, display, msg) {
      if (!properties[name]) return;
      const toCheck = propertiesToCheck[name];
      if (typeof toCheck !== 'string' ||
          toCheck !== properties[name].value.toLowerCase()) {
        const {line, col} = properties[name];
        reporter.report(msg || `${name} can't be used with display: ${display}.`,
          line, col, rule);
      }
    }

    function startRule() {
      properties = {};
    }

    function endRule() {
      const display = properties.display && properties.display.value;
      if (!display) return;

      switch (display.toLowerCase()) {

        case 'inline':
          // height, width, margin-top, margin-bottom, float should not be used with inline
          ['height', 'width', 'margin', 'margin-top', 'margin-bottom']
            .forEach(p => reportProperty(p, display));
          reportProperty('float', display,
            'display:inline has no effect on floated elements ' +
            '(but may be used to fix the IE6 double-margin bug).');
          break;

        case 'block':
          // vertical-align should not be used with block
          reportProperty('vertical-align', display);
          break;

        case 'inline-block':
          // float should not be used with inline-block
          reportProperty('float', display);
          break;

        default:
          // margin, float should not be used with table
          if (display.indexOf('table-') !== 0) return;
          ['margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'float']
            .forEach(p => reportProperty(p, display));
      }
    }

    parser.addListener('startrule', startRule);
    parser.addListener('startfontface', startRule);
    parser.addListener('startkeyframerule', startRule);
    parser.addListener('startpagemargin', startRule);
    parser.addListener('startpage', startRule);
    parser.addListener('startviewport', startRule);

    parser.addListener('property', event => {
      const name = event.property.text.toLowerCase();
      if (name in propertiesToCheck) {
        properties[name] = {
          value: event.value.text,
          line: event.property.line,
          col: event.property.col,
        };
      }
    });

    parser.addListener('endrule', endRule);
    parser.addListener('endfontface', endRule);
    parser.addListener('endkeyframerule', endRule);
    parser.addListener('endpagemargin', endRule);
    parser.addListener('endpage', endRule);
    parser.addListener('endviewport', endRule);
  },
});

CSSLint.addRule({
  id:       'duplicate-background-images',
  name:     'Disallow duplicate background images',
  desc:     'Every background-image should be unique. Use a common class for e.g. sprites.',
  url:      'https://github.com/CSSLint/csslint/wiki/Disallow-duplicate-background-images',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    const stack = {};

    parser.addListener('property', event => {
      const name = event.property.text;
      const value = event.value;
      let i, len;

      if (name.match(/background/i)) {
        for (i = 0, len = value.parts.length; i < len; i++) {
          if (value.parts[i].type === 'uri') {
            if (typeof stack[value.parts[i].uri] === 'undefined') {
              stack[value.parts[i].uri] = event;
            } else {
              reporter.report(
                "Background image '" + value.parts[i].uri + "' was used multiple times, first declared at line " +
                stack[value.parts[i].uri].line + ', col ' + stack[value.parts[i].uri].col + '.',
                event.line, event.col, rule);
            }
          }
        }
      }
    });
  },
});

CSSLint.addRule({

  id: 'duplicate-properties',
  name: 'Disallow duplicate properties',
  desc: 'Duplicate properties must appear one after the other.',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-duplicate-properties',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    let properties, lastProperty;

    function startRule() {
      properties = {};
    }

    parser.addListener('startrule', startRule);
    parser.addListener('startfontface', startRule);
    parser.addListener('startpage', startRule);
    parser.addListener('startpagemargin', startRule);
    parser.addListener('startkeyframerule', startRule);
    parser.addListener('startviewport', startRule);

    parser.addListener('property', event => {
      const property = event.property; const
name = property.text.toLowerCase();

      if (properties[name] && (lastProperty !== name || properties[name] === event.value.text)) {
        reporter.report("Duplicate property '" + event.property + "' found.", event.line, event.col, rule);
      }

      properties[name] = event.value.text;
      lastProperty = name;

    });

  },

});

CSSLint.addRule({

  id: 'empty-rules',
  name: 'Disallow empty rules',
  desc: 'Rules without any properties specified should be removed.',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-empty-rules',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this; let
count = 0;

    parser.addListener('startrule', () => {
      count = 0;
    });

    parser.addListener('property', () => {
      count++;
    });

    parser.addListener('endrule', event => {
      const selectors = event.selectors;
      if (count === 0) {
        reporter.report('Rule is empty.', selectors[0].line, selectors[0].col, rule);
      }
    });
  },

});

CSSLint.addRule({

  id: 'errors',
  name: 'Parsing Errors',
  desc: 'This rule looks for recoverable syntax errors.',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;

    parser.addListener('error', event => {
      reporter.error(event.message, event.line, event.col, rule);
    });

  },

});

CSSLint.addRule({

  id: 'fallback-colors',
  name: 'Require fallback colors',
  desc: "For older browsers that don't support RGBA, HSL, or HSLA, provide a fallback color.",
  url: 'https://github.com/CSSLint/csslint/wiki/Require-fallback-colors',
  browsers: 'IE6,IE7,IE8',

  init(parser, reporter) {
    const rule = this; let lastProperty; const
propertiesToCheck = {
  color: 1,
  background: 1,
  'border-color': 1,
  'border-top-color': 1,
  'border-right-color': 1,
  'border-bottom-color': 1,
  'border-left-color': 1,
  border: 1,
  'border-top': 1,
  'border-right': 1,
  'border-bottom': 1,
  'border-left': 1,
  'background-color': 1,
};

    function startRule() {
      lastProperty = null;
    }

    parser.addListener('startrule', startRule);
    parser.addListener('startfontface', startRule);
    parser.addListener('startpage', startRule);
    parser.addListener('startpagemargin', startRule);
    parser.addListener('startkeyframerule', startRule);
    parser.addListener('startviewport', startRule);

    parser.addListener('property', event => {
      const property = event.property;
      const
        name = property.text.toLowerCase();
      const
        parts = event.value.parts;
      let
        i = 0;
      let
        colorType = '';
      const
      len = parts.length;

      if (propertiesToCheck[name]) {
        while (i < len) {
          if (parts[i].type === 'color') {
            if ('alpha' in parts[i] || 'hue' in parts[i]) {

              if (/([^)]+)\(/.test(parts[i])) {
                colorType = RegExp.$1.toUpperCase();
              }

              if (!lastProperty ||
                  lastProperty.property.text.toLowerCase() !== name ||
                  lastProperty.colorType !== 'compat') {
                reporter.report('Fallback ' + name + ' (hex or RGB) should precede ' + colorType + ' ' + name + '.',
                  event.line, event.col, rule);
              }
            } else {
              event.colorType = 'compat';
            }
          }

          i++;
        }
      }

      lastProperty = event;
    });

  },

});

CSSLint.addRule({

  id: 'floats',
  name: 'Disallow too many floats',
  desc: 'This rule tests if the float property is used too many times',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-too-many-floats',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    let count = 0;

    // count how many times "float" is used
    parser.addListener('property', event => {
      if (event.property.text.toLowerCase() === 'float' && event.value.text.toLowerCase() !== 'none') {
        count++;
      }
    });

    // report the results
    parser.addListener('endstylesheet', () => {
      reporter.stat('floats', count);
      if (count >= 10) {
        reporter.rollupWarn('Too many floats (' + count + "), you're probably using them for layout. " +
                            'Consider using a grid system instead.', rule);
      }
    });
  },

});

CSSLint.addRule({

  id: 'font-faces',
  name: "Don't use too many web fonts",
  desc: 'Too many different web fonts in the same stylesheet.',
  url: 'https://github.com/CSSLint/csslint/wiki/Don%27t-use-too-many-web-fonts',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this; let
count = 0;

    parser.addListener('startfontface', () => {
      count++;
    });

    parser.addListener('endstylesheet', () => {
      if (count > 5) {
        reporter.rollupWarn('Too many @font-face declarations (' + count + ').', rule);
      }
    });
  },

});

CSSLint.addRule({

  id: 'font-sizes',
  name: 'Disallow too many font sizes',
  desc: 'Checks the number of font-size declarations.',
  url: 'https://github.com/CSSLint/csslint/wiki/Don%27t-use-too-many-font-size-declarations',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this; let
count = 0;

    // check for use of "font-size"
    parser.addListener('property', event => {
      if (event.property.toString() === 'font-size') {
        count++;
      }
    });

    // report the results
    parser.addListener('endstylesheet', () => {
      reporter.stat('font-sizes', count);
      if (count >= 10) {
        reporter.rollupWarn('Too many font-size declarations (' + count + '), abstraction needed.', rule);
      }
    });
  },

});

CSSLint.addRule({

  id: 'gradients',
  name: 'Require all gradient definitions',
  desc: 'When using a vendor-prefixed gradient, make sure to use them all.',
  url: 'https://github.com/CSSLint/csslint/wiki/Require-all-gradient-definitions',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this; let
gradients;

    parser.addListener('startrule', () => {
      gradients = {
        moz: 0,
        webkit: 0,
        oldWebkit: 0,
        o: 0,
      };
    });

    parser.addListener('property', event => {

      if (/-(moz|o|webkit)(?:-(?:linear|radial))-gradient/i.test(event.value)) {
        gradients[RegExp.$1] = 1;
      } else if (/-webkit-gradient/i.test(event.value)) {
        gradients.oldWebkit = 1;
      }

    });

    parser.addListener('endrule', event => {
      const missing = [];

      if (!gradients.moz) {
        missing.push('Firefox 3.6+');
      }

      if (!gradients.webkit) {
        missing.push('Webkit (Safari 5+, Chrome)');
      }

      if (!gradients.oldWebkit) {
        missing.push('Old Webkit (Safari 4+, Chrome)');
      }

      if (!gradients.o) {
        missing.push('Opera 11.1+');
      }

      if (missing.length && missing.length < 4) {
        reporter.report('Missing vendor-prefixed CSS gradients for ' + missing.join(', ') + '.',
          event.selectors[0].line, event.selectors[0].col, rule);
      }

    });

  },

});

CSSLint.addRule({

  id: 'ids',
  name: 'Disallow IDs in selectors',
  desc: 'Selectors should not contain IDs.',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-IDs-in-selectors',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    parser.addListener('startrule', event => {
      const selectors = event.selectors;
      let selector, part, modifier, idCount, i, j, k;

      for (i = 0; i < selectors.length; i++) {
        selector = selectors[i];
        idCount = 0;

        for (j = 0; j < selector.parts.length; j++) {
          part = selector.parts[j];
          if (part.type === parser.SELECTOR_PART_TYPE) {
            for (k = 0; k < part.modifiers.length; k++) {
              modifier = part.modifiers[k];
              if (modifier.type === 'id') {
                idCount++;
              }
            }
          }
        }

        if (idCount === 1) {
          reporter.report("Don't use IDs in selectors.", selector.line, selector.col, rule);
        } else if (idCount > 1) {
          reporter.report(idCount + ' IDs in the selector, really?', selector.line, selector.col, rule);
        }
      }

    });
  },

});

CSSLint.addRule({

  id: 'import-ie-limit',
  name: '@import limit on IE6-IE9',
  desc: 'IE6-9 supports up to 31 @import per stylesheet',
  browsers: 'IE6, IE7, IE8, IE9',

  init(parser, reporter) {
    const rule = this; const MAX_IMPORT_COUNT = 31; let
count = 0;

    function startPage() {
      count = 0;
    }

    parser.addListener('startpage', startPage);

    parser.addListener('import', () => {
      count++;
    });

    parser.addListener('endstylesheet', () => {
      if (count > MAX_IMPORT_COUNT) {
        reporter.rollupError('Too many @import rules (' + count +
                             '). IE6-9 supports up to 31 import per stylesheet.', rule);
      }
    });
  },

});

CSSLint.addRule({

  id: 'import',
  name: 'Disallow @import',
  desc: "Don't use @import, use <link> instead.",
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-%40import',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;

    parser.addListener('import', event => {
      reporter.report('@import prevents parallel downloads, use <link> instead.', event.line, event.col, rule);
    });

  },

});

CSSLint.addRule({

  id: 'important',
  name: 'Disallow !important',
  desc: 'Be careful when using !important declaration',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-%21important',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this; let
count = 0;

    // warn that important is used and increment the declaration counter
    parser.addListener('property', event => {
      if (event.important === true) {
        count++;
        reporter.report('Use of !important', event.line, event.col, rule);
      }
    });

    // if there are more than 10, show an error
    parser.addListener('endstylesheet', () => {
      reporter.stat('important', count);
      if (count >= 10) {
        reporter.rollupWarn('Too many !important declarations (' + count + '), ' +
                            'try to use less than 10 to avoid specificity issues.', rule);
      }
    });
  },

});

CSSLint.addRule({

  id: 'known-properties',
  name: 'Require use of known properties',
  desc: 'Properties should be known (listed in CSS3 specification) or be a vendor-prefixed property.',
  url: 'https://github.com/CSSLint/csslint/wiki/Require-use-of-known-properties',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;

    parser.addListener('property', event => {

      // the check is handled entirely by the parser-lib (https://github.com/nzakas/parser-lib)
      if (event.invalid) {
        reporter.report(event.invalid.message, event.line, event.col, rule);
      }

    });
  },

});

CSSLint.addRule({

  id: 'order-alphabetical',
  name: 'Alphabetical order',
  desc: 'Assure properties are in alphabetical order',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this; let
properties;

    const startRule = () => {
      properties = [];
    };

    const endRule = event => {
      const currentProperties = properties.join(','); const
expectedProperties = properties.sort().join(',');

      if (currentProperties !== expectedProperties) {
        reporter.report("Rule doesn't have all its properties in alphabetical order.", event.line, event.col, rule);
      }
    };

    parser.addListener('startrule', startRule);
    parser.addListener('startfontface', startRule);
    parser.addListener('startpage', startRule);
    parser.addListener('startpagemargin', startRule);
    parser.addListener('startkeyframerule', startRule);
    parser.addListener('startviewport', startRule);

    parser.addListener('property', event => {
      const name = event.property.text; const
lowerCasePrefixLessName = name.toLowerCase().replace(/^-.*?-/, '');

      properties.push(lowerCasePrefixLessName);
    });

    parser.addListener('endrule', endRule);
    parser.addListener('endfontface', endRule);
    parser.addListener('endpage', endRule);
    parser.addListener('endpagemargin', endRule);
    parser.addListener('endkeyframerule', endRule);
    parser.addListener('endviewport', endRule);
  },

});

CSSLint.addRule({

  id: 'outline-none',
  name: 'Disallow outline: none',
  desc: 'Use of outline: none or outline: 0 should be limited to :focus rules.',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-outline%3Anone',
  browsers: 'All',
  tags: ['Accessibility'],

  init(parser, reporter) {
    const rule = this; let
lastRule;

    function startRule(event) {
      if (event.selectors) {
        lastRule = {
          line: event.line,
          col: event.col,
          selectors: event.selectors,
          propCount: 0,
          outline: false,
        };
      } else {
        lastRule = null;
      }
    }

    function endRule() {
      if (lastRule) {
        if (lastRule.outline) {
          if (lastRule.selectors.toString().toLowerCase().indexOf(':focus') === -1) {
            reporter.report('Outlines should only be modified using :focus.', lastRule.line, lastRule.col, rule);
          } else if (lastRule.propCount === 1) {
            reporter.report("Outlines shouldn't be hidden unless other visual changes are made.",
              lastRule.line, lastRule.col, rule);
          }
        }
      }
    }

    parser.addListener('startrule', startRule);
    parser.addListener('startfontface', startRule);
    parser.addListener('startpage', startRule);
    parser.addListener('startpagemargin', startRule);
    parser.addListener('startkeyframerule', startRule);
    parser.addListener('startviewport', startRule);

    parser.addListener('property', event => {
      const name = event.property.text.toLowerCase(); const
value = event.value;

      if (lastRule) {
        lastRule.propCount++;
        if (name === 'outline' && (value.toString() === 'none' || value.toString() === '0')) {
          lastRule.outline = true;
        }
      }

    });

    parser.addListener('endrule', endRule);
    parser.addListener('endfontface', endRule);
    parser.addListener('endpage', endRule);
    parser.addListener('endpagemargin', endRule);
    parser.addListener('endkeyframerule', endRule);
    parser.addListener('endviewport', endRule);

  },

});

CSSLint.addRule({

  id: 'overqualified-elements',
  name: 'Disallow overqualified elements',
  desc: "Don't use classes or IDs with elements (a.foo or a#foo).",
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-overqualified-elements',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    const classes = {};

    parser.addListener('startrule', event => {
      for (const selector of event.selectors) {
        for (const part of selector.parts) {
          if (part.type !== parser.SELECTOR_PART_TYPE) continue;
          for (const modifier of part.modifiers) {
            if (part.elementName && modifier.type === 'id') {
              reporter.report('Element (' + part + ') is overqualified, just use ' + modifier +
                              ' without element name.', part.line, part.col, rule);
            } else if (modifier.type === 'class') {
              if (!classes[modifier]) {
                classes[modifier] = [];
              }
              classes[modifier].push({
                modifier: modifier,
                part:     part,
              });
            }
          }
        }
      }
    });

    parser.addListener('endstylesheet', () => {
      for (const prop in classes) {
        if (!Object.hasOwnProperty.call(classes, prop)) continue;
        // one use means that this is overqualified
        const cls = classes[prop][0];
        if (cls.part.elementName && classes[prop].length === 1) {
          reporter.report(
            'Element (' + cls.part + ') is overqualified, just use ' +
            cls.modifier + ' without element name.',
            cls.part.line, cls.part.col, rule);
        }
      }
    });
  },

});

CSSLint.addRule({

  id: 'qualified-headings',
  name: 'Disallow qualified headings',
  desc: 'Headings should not be qualified (namespaced).',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-qualified-headings',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;

    parser.addListener('startrule', event => {
      for (const selector of event.selectors) {
        let first = true;
        for (const part of selector.parts) {
          if (part.elementName &&
              part.type === parser.SELECTOR_PART_TYPE &&
              /h[1-6]/.test(part.elementName.toString()) && !first) {
            reporter.report('Heading (' + part.elementName + ') should not be qualified.',
              part.line, part.col, rule);
          }
          first = false;
        }
      }
    });
  },

});

CSSLint.addRule({

  id: 'regex-selectors',
  name: 'Disallow selectors that look like regexs',
  desc: 'Selectors that look like regular expressions are slow and should be avoided.',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-selectors-that-look-like-regular-expressions',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;

    parser.addListener('startrule', event => {
      for (const selector of event.selectors) {
        for (const part of selector.parts) {
          if (part.type !== parser.SELECTOR_PART_TYPE) continue;
          for (const modifier of part.modifiers) {
            if (modifier.type !== 'attribute' || !/([~|^$*]=)/.test(modifier)) continue;
            reporter.report('Attribute selectors with ' + RegExp.$1 + ' are slow!',
              modifier.line, modifier.col, rule);
          }
        }
      }
    });
  },

});

CSSLint.addRule({

  id: 'rules-count',
  name: 'Rules Count',
  desc: 'Track how many rules there are.',
  browsers: 'All',

  init(parser, reporter) {
    let count = 0;

    // count each rule
    parser.addListener('startrule', () => {
      count++;
    });

    parser.addListener('endstylesheet', () => {
      reporter.stat('rule-count', count);
    });
  },

});

CSSLint.addRule({

  id: 'selector-max-approaching',
  name: 'Warn when approaching the 4095 selector limit for IE',
  desc: 'Will warn when selector count is >= 3800 selectors.',
  browsers: 'IE',

  init(parser, reporter) {
    const rule = this; let
count = 0;

    parser.addListener('startrule', event => {
      count += event.selectors.length;
    });

    parser.addListener('endstylesheet', () => {
      if (count >= 3800) {
        reporter.report(
          'You have ' + count + ' selectors. ' +
          'Internet Explorer supports a maximum of 4095 selectors per stylesheet. ' +
          'Consider refactoring.', 0, 0, rule);
      }
    });
  },

});

CSSLint.addRule({

  id: 'selector-max',
  name: 'Error when past the 4095 selector limit for IE',
  desc: 'Will error when selector count is > 4095.',
  browsers: 'IE',

  init(parser, reporter) {
    const rule = this; let
count = 0;

    parser.addListener('startrule', event => {
      count += event.selectors.length;
    });

    parser.addListener('endstylesheet', () => {
      if (count > 4095) {
        reporter.report(
          'You have ' + count + ' selectors. ' +
          'Internet Explorer supports a maximum of 4095 selectors per stylesheet. ' +
          'Consider refactoring.', 0, 0, rule);
      }
    });
  },

});

CSSLint.addRule({

  id: 'selector-newline',
  name: 'Disallow new-line characters in selectors',
  desc: 'New-line characters in selectors are usually a forgotten comma and not a descendant combinator.',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;

    function startRule(event) {
      let i, len, selector, p, n, pLen, part, part2, type, currentLine, nextLine;
      const selectors = event.selectors;

      for (i = 0, len = selectors.length; i < len; i++) {
        selector = selectors[i];
        for (p = 0, pLen = selector.parts.length; p < pLen; p++) {
          for (n = p + 1; n < pLen; n++) {
            part = selector.parts[p];
            part2 = selector.parts[n];
            type = part.type;
            currentLine = part.line;
            nextLine = part2.line;

            if (type === 'descendant' && nextLine > currentLine) {
              reporter.report('newline character found in selector (forgot a comma?)',
                currentLine, selectors[i].parts[0].col, rule);
            }
          }
        }

      }
    }

    parser.addListener('startrule', startRule);

  },
});

CSSLint.addRule({

  id: 'shorthand',
  name: 'Require shorthand properties',
  desc: 'Use shorthand properties where possible.',
  url: 'https://github.com/CSSLint/csslint/wiki/Require-shorthand-properties',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    const propertiesToCheck = {};
    const mapping = {
      margin:  ['margin-top', 'margin-bottom', 'margin-left', 'margin-right'],
      padding: ['padding-top', 'padding-bottom', 'padding-left', 'padding-right'],
    };
    let prop, i, len, properties;

    // initialize propertiesToCheck
    for (prop in mapping) {
      if (mapping.hasOwnProperty(prop)) {
        for (i = 0, len = mapping[prop].length; i < len; i++) {
          propertiesToCheck[mapping[prop][i]] = prop;
        }
      }
    }

    function startRule() {
      properties = {};
    }

    // event handler for end of rules
    function endRule(event) {

      let prop, i, len, total;

      // check which properties this rule has
      for (prop in mapping) {
        if (mapping.hasOwnProperty(prop)) {
          total = 0;

          for (i = 0, len = mapping[prop].length; i < len; i++) {
            total += properties[mapping[prop][i]] ? 1 : 0;
          }

          if (total === mapping[prop].length) {
            reporter.report('The properties ' + mapping[prop].join(', ') + ' can be replaced by ' + prop + '.',
              event.line, event.col, rule);
          }
        }
      }
    }

    parser.addListener('startrule', startRule);
    parser.addListener('startfontface', startRule);

    // check for use of "font-size"
    parser.addListener('property', event => {
      const name = event.property.toString().toLowerCase();

      if (propertiesToCheck[name]) {
        properties[name] = 1;
      }
    });

    parser.addListener('endrule', endRule);
    parser.addListener('endfontface', endRule);

  },

});

CSSLint.addRule({

  id: 'star-property-hack',
  name: 'Disallow properties with a star prefix',
  desc: 'Checks for the star property hack (targets IE6/7)',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-star-hack',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;

    // check if property name starts with "*"
    parser.addListener('property', event => {
      const property = event.property;

      if (property.hack === '*') {
        reporter.report('Property with star prefix found.', event.property.line, event.property.col, rule);
      }
    });
  },
});

CSSLint.addRule({

  id: 'text-indent',
  name: 'Disallow negative text-indent',
  desc: 'Checks for text indent less than -99px',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-negative-text-indent',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    let textIndent, direction;

    function startRule() {
      textIndent = false;
      direction = 'inherit';
    }

    // event handler for end of rules
    function endRule() {
      if (textIndent && direction !== 'ltr') {
        reporter.report(
          "Negative text-indent doesn't work well with RTL. " +
          'If you use text-indent for image replacement explicitly set direction for that item to ltr.',
          textIndent.line, textIndent.col, rule);
      }
    }

    parser.addListener('startrule', startRule);
    parser.addListener('startfontface', startRule);

    // check for use of "font-size"
    parser.addListener('property', event => {
      const name = event.property.toString().toLowerCase(); const
value = event.value;

      if (name === 'text-indent' && value.parts[0].value < -99) {
        textIndent = event.property;
      } else if (name === 'direction' && value.toString() === 'ltr') {
        direction = 'ltr';
      }
    });

    parser.addListener('endrule', endRule);
    parser.addListener('endfontface', endRule);

  },

});

CSSLint.addRule({

  id: 'underscore-property-hack',
  name: 'Disallow properties with an underscore prefix',
  desc: 'Checks for the underscore property hack (targets IE6)',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-underscore-hack',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;

    // check if property name starts with "_"
    parser.addListener('property', event => {
      const property = event.property;

      if (property.hack === '_') {
        reporter.report('Property with underscore prefix found.', event.property.line, event.property.col, rule);
      }
    });
  },
});

CSSLint.addRule({

  id: 'unique-headings',
  name: 'Headings should only be defined once',
  desc: 'Headings should be defined only once.',
  url: 'https://github.com/CSSLint/csslint/wiki/Headings-should-only-be-defined-once',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;

    const headings = {
      h1: 0,
      h2: 0,
      h3: 0,
      h4: 0,
      h5: 0,
      h6: 0,
    };

    parser.addListener('startrule', event => {
      const selectors = event.selectors;
      let selector, part, pseudo, i, j;

      for (i = 0; i < selectors.length; i++) {
        selector = selectors[i];
        part = selector.parts[selector.parts.length - 1];

        if (part.elementName && /(h[1-6])/i.test(part.elementName.toString())) {

          for (j = 0; j < part.modifiers.length; j++) {
            if (part.modifiers[j].type === 'pseudo') {
              pseudo = true;
              break;
            }
          }

          if (!pseudo) {
            headings[RegExp.$1]++;
            if (headings[RegExp.$1] > 1) {
              reporter.report('Heading (' + part.elementName + ') has already been defined.',
                part.line, part.col, rule);
            }
          }
        }
      }
    });

    parser.addListener('endstylesheet', () => {
      let prop; const
messages = [];

      for (prop in headings) {
        if (headings.hasOwnProperty(prop)) {
          if (headings[prop] > 1) {
            messages.push(headings[prop] + ' ' + prop + 's');
          }
        }
      }

      if (messages.length) {
        reporter.rollupWarn('You have ' + messages.join(', ') + ' defined in this stylesheet.', rule);
      }
    });
  },

});

CSSLint.addRule({

  id: 'universal-selector',
  name: 'Disallow universal selector',
  desc: 'The universal selector (*) is known to be slow.',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-universal-selector',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;

    parser.addListener('startrule', event => {
      const selectors = event.selectors;
      let selector, part, i;

      for (i = 0; i < selectors.length; i++) {
        selector = selectors[i];

        part = selector.parts[selector.parts.length - 1];
        if (part.elementName === '*') {
          reporter.report(rule.desc, part.line, part.col, rule);
        }
      }
    });
  },

});

CSSLint.addRule({

  id: 'unqualified-attributes',
  name: 'Disallow unqualified attribute selectors',
  desc: 'Unqualified attribute selectors are known to be slow.',
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-unqualified-attribute-selectors',
  browsers: 'All',

  init(parser, reporter) {

    const rule = this;

    parser.addListener('startrule', event => {

      const selectors = event.selectors;
      let selectorContainsClassOrId = false;
      let selector, part, modifier, i, k;

      for (i = 0; i < selectors.length; i++) {
        selector = selectors[i];

        part = selector.parts[selector.parts.length - 1];
        if (part.type === parser.SELECTOR_PART_TYPE) {
          for (k = 0; k < part.modifiers.length; k++) {
            modifier = part.modifiers[k];

            if (modifier.type === 'class' || modifier.type === 'id') {
              selectorContainsClassOrId = true;
              break;
            }
          }

          if (!selectorContainsClassOrId) {
            for (k = 0; k < part.modifiers.length; k++) {
              modifier = part.modifiers[k];
              if (modifier.type === 'attribute' && (!part.elementName || part.elementName === '*')) {
                reporter.report(rule.desc, part.line, part.col, rule);
              }
            }
          }
        }

      }
    });
  },

});

CSSLint.addRule({

  id: 'vendor-prefix',
  name: 'Require standard property with vendor prefix',
  desc: 'When using a vendor-prefixed property, make sure to include the standard one.',
  url: 'https://github.com/CSSLint/csslint/wiki/Require-standard-property-with-vendor-prefix',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;
    let properties, num;
    const propertiesToCheck = {
      '-webkit-border-radius':              'border-radius',
      '-webkit-border-top-left-radius':     'border-top-left-radius',
      '-webkit-border-top-right-radius':    'border-top-right-radius',
      '-webkit-border-bottom-left-radius':  'border-bottom-left-radius',
      '-webkit-border-bottom-right-radius': 'border-bottom-right-radius',

      '-o-border-radius':              'border-radius',
      '-o-border-top-left-radius':     'border-top-left-radius',
      '-o-border-top-right-radius':    'border-top-right-radius',
      '-o-border-bottom-left-radius':  'border-bottom-left-radius',
      '-o-border-bottom-right-radius': 'border-bottom-right-radius',

      '-moz-border-radius':             'border-radius',
      '-moz-border-radius-topleft':     'border-top-left-radius',
      '-moz-border-radius-topright':    'border-top-right-radius',
      '-moz-border-radius-bottomleft':  'border-bottom-left-radius',
      '-moz-border-radius-bottomright': 'border-bottom-right-radius',

      '-moz-column-count':    'column-count',
      '-webkit-column-count': 'column-count',

      '-moz-column-gap':    'column-gap',
      '-webkit-column-gap': 'column-gap',

      '-moz-column-rule':    'column-rule',
      '-webkit-column-rule': 'column-rule',

      '-moz-column-rule-style':    'column-rule-style',
      '-webkit-column-rule-style': 'column-rule-style',

      '-moz-column-rule-color':    'column-rule-color',
      '-webkit-column-rule-color': 'column-rule-color',

      '-moz-column-rule-width':    'column-rule-width',
      '-webkit-column-rule-width': 'column-rule-width',

      '-moz-column-width':    'column-width',
      '-webkit-column-width': 'column-width',

      '-webkit-column-span': 'column-span',
      '-webkit-columns':     'columns',

      '-moz-box-shadow':    'box-shadow',
      '-webkit-box-shadow': 'box-shadow',

      '-moz-transform':    'transform',
      '-webkit-transform': 'transform',
      '-o-transform':      'transform',
      '-ms-transform':     'transform',

      '-moz-transform-origin':    'transform-origin',
      '-webkit-transform-origin': 'transform-origin',
      '-o-transform-origin':      'transform-origin',
      '-ms-transform-origin':     'transform-origin',

      '-moz-box-sizing':    'box-sizing',
      '-webkit-box-sizing': 'box-sizing',
    };

    // event handler for beginning of rules
    function startRule() {
      properties = {};
      num = 1;
    }

    // event handler for end of rules
    function endRule() {
      let prop, i, len, needed, actual;
      const needsStandard = [];

      for (prop in properties) {
        if (propertiesToCheck[prop]) {
          needsStandard.push({
            actual: prop,
            needed: propertiesToCheck[prop],
          });
        }
      }

      for (i = 0, len = needsStandard.length; i < len; i++) {
        needed = needsStandard[i].needed;
        actual = needsStandard[i].actual;

        if (!properties[needed]) {
          reporter.report("Missing standard property '" + needed + "' to go along with '" + actual + "'.",
            properties[actual][0].name.line, properties[actual][0].name.col, rule);
        } else {
          // make sure standard property is last
          if (properties[needed][0].pos < properties[actual][0].pos) {
            reporter.report(
              "Standard property '" + needed + "' should come after vendor-prefixed property '" + actual + "'.",
              properties[actual][0].name.line, properties[actual][0].name.col, rule);
          }
        }
      }

    }

    parser.addListener('startrule', startRule);
    parser.addListener('startfontface', startRule);
    parser.addListener('startpage', startRule);
    parser.addListener('startpagemargin', startRule);
    parser.addListener('startkeyframerule', startRule);
    parser.addListener('startviewport', startRule);

    parser.addListener('property', event => {
      const name = event.property.text.toLowerCase();

      if (!properties[name]) {
        properties[name] = [];
      }

      properties[name].push({
        name: event.property,
        value: event.value,
        pos: num++,
      });
    });

    parser.addListener('endrule', endRule);
    parser.addListener('endfontface', endRule);
    parser.addListener('endpage', endRule);
    parser.addListener('endpagemargin', endRule);
    parser.addListener('endkeyframerule', endRule);
    parser.addListener('endviewport', endRule);
  },

});

CSSLint.addRule({

  id: 'zero-units',
  name: 'Disallow units for 0 values',
  desc: "You don't need to specify units when a value is 0.",
  url: 'https://github.com/CSSLint/csslint/wiki/Disallow-units-for-zero-values',
  browsers: 'All',

  init(parser, reporter) {
    const rule = this;

    // count how many times "float" is used
    parser.addListener('property', event => {
      const parts = event.value.parts; let i = 0; const
len = parts.length;

      while (i < len) {
        if ((parts[i].units || parts[i].type === 'percentage') && parts[i].value === 0 && parts[i].type !== 'time') {
          reporter.report("Values of 0 shouldn't have units specified.", parts[i].line, parts[i].col, rule);
        }
        i++;
      }

    });

  },

});

//endregion

/* global dbExec, getStyles, saveStyle */
/* global handleCssTransitionBug */
/* global usercssHelper openEditor */
/* global styleViaAPI */
'use strict';

// eslint-disable-next-line no-var
var browserCommands, contextMenus;

// *************************************************************************
// register all listeners
chrome.runtime.onMessage.addListener(onRuntimeMessage);

{
  const listener =
    URLS.chromeProtectsNTP
      ? webNavigationListenerChrome
      : webNavigationListener;

  chrome.webNavigation.onBeforeNavigate.addListener(data =>
    listener(null, data));

  chrome.webNavigation.onCommitted.addListener(data =>
    listener('styleApply', data));

  chrome.webNavigation.onHistoryStateUpdated.addListener(data =>
    listener('styleReplaceAll', data));

  chrome.webNavigation.onReferenceFragmentUpdated.addListener(data =>
    listener('styleReplaceAll', data));

  if (FIREFOX) {
    // FF applies page CSP even to content scripts, https://bugzil.la/1267027
    chrome.webNavigation.onCommitted.addListener(webNavUsercssInstallerFF, {
      url: [
        {urlPrefix: 'https://raw.githubusercontent.com/', urlSuffix: '.user.css'},
        {urlPrefix: 'https://raw.githubusercontent.com/', urlSuffix: '.user.styl'},
      ]
    });
  }
}

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) =>
    contextMenus[info.menuItemId].click(info, tab));
}

if (chrome.commands) {
  // Not available in Firefox - https://bugzilla.mozilla.org/show_bug.cgi?id=1240350
  chrome.commands.onCommand.addListener(command => browserCommands[command]());
}

if (!chrome.browserAction ||
    !['setIcon', 'setBadgeBackgroundColor', 'setBadgeText'].every(name => chrome.browserAction[name])) {
  window.updateIcon = () => {};
}

// *************************************************************************
// set the default icon displayed after a tab is created until webNavigation kicks in
prefs.subscribe(['iconset'], () => updateIcon({id: undefined}, {}));

// *************************************************************************
{
  const onInstall = ({reason}) => {
    chrome.runtime.onInstalled.removeListener(onInstall);
    // reset L10N cache on update
    if (reason === 'update') {
      localStorage.L10N = JSON.stringify({
        browserUIlanguage: chrome.i18n.getUILanguage(),
      });
    }
  };
  // bind for 60 seconds max and auto-unbind if it's a normal run
  chrome.runtime.onInstalled.addListener(onInstall);
  setTimeout(onInstall, 60e3, {reason: 'unbindme'});
}

// *************************************************************************
// browser commands
browserCommands = {
  openManage() {
    openURL({url: 'manage.html'});
  },
  styleDisableAll(info) {
    prefs.set('disableAll', info ? info.checked : !prefs.get('disableAll'));
  },
};

// *************************************************************************
// context menus
contextMenus = {
  'show-badge': {
    title: 'menuShowBadge',
    click: info => prefs.set(info.menuItemId, info.checked),
  },
  'disableAll': {
    title: 'disableAllStyles',
    click: browserCommands.styleDisableAll,
  },
  'open-manager': {
    title: 'openStylesManager',
    click: browserCommands.openManage,
  },
  'editor.contextDelete': {
    presentIf: () => !FIREFOX && prefs.get('editor.contextDelete'),
    title: 'editDeleteText',
    type: 'normal',
    contexts: ['editable'],
    documentUrlPatterns: [URLS.ownOrigin + 'edit*'],
    click: (info, tab) => {
      sendMessage({tabId: tab.id, method: 'editDeleteText'});
    },
  }
};

if (chrome.contextMenus) {
  const createContextMenus = ids => {
    for (const id of ids) {
      let item = contextMenus[id];
      if (item.presentIf && !item.presentIf()) {
        continue;
      }
      item = Object.assign({id}, item);
      delete item.presentIf;
      const prefValue = prefs.readOnlyValues[id];
      item.title = chrome.i18n.getMessage(item.title);
      if (!item.type && typeof prefValue === 'boolean') {
        item.type = 'checkbox';
        item.checked = prefValue;
      }
      if (!item.contexts) {
        item.contexts = ['browser_action'];
      }
      delete item.click;
      chrome.contextMenus.create(item, ignoreChromeError);
    }
  };

  // circumvent the bug with disabling check marks in Chrome 62-64
  const toggleCheckmark = CHROME >= 3172 && CHROME <= 3288 ?
    (id => chrome.contextMenus.remove(id, () => createContextMenus([id]) + ignoreChromeError())) :
    ((id, checked) => chrome.contextMenus.update(id, {checked}, ignoreChromeError));

  const togglePresence = (id, checked) => {
    if (checked) {
      createContextMenus([id]);
    } else {
      chrome.contextMenus.remove(id, ignoreChromeError);
    }
  };

  const keys = Object.keys(contextMenus);
  prefs.subscribe(keys.filter(id => typeof prefs.readOnlyValues[id] === 'boolean'), toggleCheckmark);
  prefs.subscribe(keys.filter(id => contextMenus[id].presentIf), togglePresence);
  createContextMenus(keys);
}

// *************************************************************************
// [re]inject content scripts
window.addEventListener('storageReady', function _() {
  window.removeEventListener('storageReady', _);

  updateIcon({id: undefined}, {});

  const NTP = 'chrome://newtab/';
  const ALL_URLS = '<all_urls>';
  const contentScripts = chrome.runtime.getManifest().content_scripts;
  // expand * as .*?
  const wildcardAsRegExp = (s, flags) => new RegExp(
      s.replace(/[{}()[\]/\\.+?^$:=!|]/g, '\\$&')
        .replace(/\*/g, '.*?'), flags);
  for (const cs of contentScripts) {
    cs.matches = cs.matches.map(m => (
      m === ALL_URLS ? m : wildcardAsRegExp(m)
    ));
  }

  const injectCS = (cs, tabId) => {
    chrome.tabs.executeScript(tabId, {
      file: cs.js[0],
      runAt: cs.run_at,
      allFrames: cs.all_frames,
      matchAboutBlank: cs.match_about_blank,
    }, ignoreChromeError);
  };

  const pingCS = (cs, {id, url}) => {
    const maybeInject = pong => !pong && injectCS(cs, id);
    cs.matches.some(match => {
      if ((match === ALL_URLS || url.match(match)) &&
          (!url.startsWith('chrome') || url === NTP)) {
        sendMessage({method: 'ping', tabId: id}, maybeInject);
        return true;
      }
    });
  };

  queryTabs().then(tabs =>
    tabs.forEach(tab => {
      // skip lazy-loaded aka unloaded tabs that seem to start loading on message in FF
      if (!FIREFOX || tab.width) {
        contentScripts.forEach(cs =>
          setTimeout(pingCS, 0, cs, tab));
      }
    }));
});

// *************************************************************************

function webNavigationListener(method, {url, tabId, frameId}) {
  getStyles({matchUrl: url, enabled: true, asHash: true}).then(styles => {
    if (method && URLS.supported(url) && tabId >= 0) {
      if (method === 'styleApply') {
        handleCssTransitionBug({tabId, frameId, url, styles});
      }
      sendMessage({
        tabId,
        frameId,
        method,
        // ping own page so it retrieves the styles directly
        styles: url.startsWith(URLS.ownOrigin) ? 'DIY' : styles,
      });
    }
    // main page frame id is 0
    if (frameId === 0) {
      updateIcon({id: tabId, url}, styles);
    }
  });
}


function webNavigationListenerChrome(method, data) {
  // Chrome 61.0.3161+ doesn't run content scripts on NTP
  if (
    !data.url.startsWith('https://www.google.') ||
    !data.url.includes('/_/chrome/newtab?')
  ) {
    webNavigationListener(method, data);
    return;
  }
  getTab(data.tabId).then(tab => {
    if (tab.url === 'chrome://newtab/') {
      data.url = tab.url;
    }
    webNavigationListener(method, data);
  });
}


function webNavUsercssInstallerFF(data) {
  const {tabId} = data;
  Promise.all([
    sendMessage({tabId, method: 'ping'}),
    // we need tab index to open the installer next to the original one
    // and also to skip the double-invocation in FF which assigns tab url later
    getTab(tabId),
  ]).then(([pong, tab]) => {
    if (pong !== true && tab.url !== 'about:blank') {
      usercssHelper.openInstallPage(tab, {direct: true});
    }
  });
}


function updateIcon(tab, styles) {
  if (tab.id < 0) {
    return;
  }
  if (URLS.chromeProtectsNTP && tab.url === 'chrome://newtab/') {
    styles = {};
  }
  if (styles) {
    stylesReceived(styles);
    return;
  }
  getTabRealURL(tab)
    .then(url => getStyles({matchUrl: url, enabled: true, asHash: true}))
    .then(stylesReceived);

  function stylesReceived(styles) {
    let numStyles = styles.length;
    if (numStyles === undefined) {
      // for 'styles' asHash:true fake the length by counting numeric ids manually
      numStyles = 0;
      for (const id of Object.keys(styles)) {
        numStyles += id.match(/^\d+$/) ? 1 : 0;
      }
    }
    const disableAll = 'disableAll' in styles ? styles.disableAll : prefs.get('disableAll');
    const postfix = disableAll ? 'x' : numStyles === 0 ? 'w' : '';
    const color = prefs.get(disableAll ? 'badgeDisabled' : 'badgeNormal');
    const text = prefs.get('show-badge') && numStyles ? String(numStyles) : '';
    const iconset = ['', 'light/'][prefs.get('iconset')] || '';
    const path = 'images/icon/' + iconset;
    chrome.browserAction.setIcon({
      tabId: tab.id,
      path: {
        // Material Design 2016 new size is 16px
        16: `${path}16${postfix}.png`,
        32: `${path}32${postfix}.png`,
        // Chromium forks or non-chromium browsers may still use the traditional 19px
        19: `${path}19${postfix}.png`,
        38: `${path}38${postfix}.png`,
        // TODO: add Edge preferred sizes: 20, 25, 30, 40
      },
    }, () => {
      if (chrome.runtime.lastError || tab.id === undefined) {
        return;
      }
      // Vivaldi bug workaround: setBadgeText must follow setBadgeBackgroundColor
      chrome.browserAction.setBadgeBackgroundColor({color});
      setTimeout(() => {
        getTab(tab.id).then(realTab => {
          // skip pre-rendered tabs
          if (realTab.index >= 0) {
            chrome.browserAction.setBadgeText({text, tabId: tab.id});
          }
        });
      });
    });
  }
}


function onRuntimeMessage(request, sender, sendResponseInternal) {
  const sendResponse = data => {
    // wrap Error object instance as {__ERROR__: message} - will be unwrapped in sendMessage
    if (data instanceof Error) {
      data = {__ERROR__: data.message};
    }
    // prevent browser exception bug on sending a response to a closed tab
    tryCatch(sendResponseInternal, data);
  };
  switch (request.method) {
    case 'getStyles':
      getStyles(request).then(sendResponse);
      return KEEP_CHANNEL_OPEN;

    case 'saveStyle':
      saveStyle(request).then(sendResponse);
      return KEEP_CHANNEL_OPEN;

    case 'saveUsercss':
      usercssHelper.save(request, true).then(sendResponse);
      return KEEP_CHANNEL_OPEN;

    case 'buildUsercss':
      usercssHelper.build(request, true).then(sendResponse);
      return KEEP_CHANNEL_OPEN;

    case 'healthCheck':
      dbExec()
        .then(() => sendResponse(true))
        .catch(() => sendResponse(false));
      return KEEP_CHANNEL_OPEN;

    case 'styleViaAPI':
      styleViaAPI(request, sender);
      return;

    case 'download':
      download(request.url)
        .then(sendResponse)
        .catch(() => sendResponse(null));
      return KEEP_CHANNEL_OPEN;

    case 'openUsercssInstallPage':
      usercssHelper.openInstallPage(sender.tab, request).then(sendResponse);
      return KEEP_CHANNEL_OPEN;

    case 'closeTab':
      chrome.tabs.remove(request.tabId || sender.tab.id, () => {
        if (chrome.runtime.lastError && request.tabId !== sender.tab.id) {
          sendResponse(new Error(chrome.runtime.lastError.message));
        }
      });
      return KEEP_CHANNEL_OPEN;

    case 'openEditor':
      openEditor(request.id);
      return;
  }
}

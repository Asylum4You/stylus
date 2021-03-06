/* global installed updateStripes */
/* global messageBox */
'use strict';

const sorter = (() => {

  const sorterType = {
    alpha: (a, b) => a < b ? -1 : a === b ? 0 : 1,
    number: (a, b) => (a || 0) - (b || 0),
  };

  const tagData = {
    title: {
      text: t('genericTitle'),
      parse: ({name}) => name,
      sorter: sorterType.alpha
    },
    usercss: {
      text: 'Usercss',
      parse: ({style}) => style.usercssData ? 0 : 1,
      sorter: sorterType.number
    },
    disabled: {
      text: '', // added as either "enabled" or "disabled" by the addOptions function
      parse: ({style}) => style.enabled ? 1 : 0,
      sorter: sorterType.number
    },
    dateInstalled: {
      text: t('dateInstalled'),
      parse: ({style}) => style.installDate,
      sorter: sorterType.number
    },
    dateUpdated: {
      text: t('dateUpdated'),
      parse: ({style}) => style.updateDate,
      sorter: sorterType.number
    }
  };

  // Adding (assumed) most commonly used ('title,asc' should always be first)
  // whitespace before & after the comma is ignored
  const selectOptions = [
    '{groupAsc}',
    'title,asc',
    'dateInstalled,desc, title,asc',
    'dateInstalled,asc, title,asc',
    'dateUpdated,desc, title,asc',
    'dateUpdated,asc, title,asc',
    'usercss,asc, title,asc',
    'usercss,desc, title,asc',
    'disabled,asc, title,asc',
    'disabled,desc, title,asc',
    'disabled,desc, usercss,asc, title,asc',
    '{groupDesc}',
    'title,desc',
    'usercss,asc, title,desc',
    'usercss,desc, title,desc',
    'disabled,desc, title,desc',
    'disabled,desc, usercss,asc, title,desc'
  ];

  const splitRegex = /\s*,\s*/;

  function addOptions() {
    let container;
    const select = $('#manage.newUI.sort');
    const renderBin = document.createDocumentFragment();
    const option = $create('option');
    const optgroup = $create('optgroup');
    const meta = {
      desc: ' \u21E9',
      enabled: t('genericEnabledLabel'),
      disabled: t('genericDisabledLabel'),
      dateNew: ` (${t('sortDateNewestFirst')})`,
      dateOld: ` (${t('sortDateOldestFirst')})`,
      groupAsc: t('sortLabelTitleAsc'),
      groupDesc: t('sortLabelTitleDesc')
    };
    const optgroupRegex = /\{\w+\}/;
    selectOptions.forEach(sort => {
      if (optgroupRegex.test(sort)) {
        if (container) {
          renderBin.appendChild(container);
        }
        container = optgroup.cloneNode();
        container.label = meta[sort.substring(1, sort.length - 1)];
        return;
      }
      let lastTag = '';
      const opt = option.cloneNode();
      opt.textContent = sort.split(splitRegex).reduce((acc, val) => {
        if (tagData[val]) {
          lastTag = val;
          return acc + (acc !== '' ? ' + ' : '') + tagData[val].text;
        }
        if (lastTag.indexOf('date') > -1) return acc + meta[val === 'desc' ? 'dateNew' : 'dateOld'];
        if (lastTag === 'disabled') return acc + meta[val === 'desc' ? 'enabled' : 'disabled'];
        return acc + (meta[val] || '');
      }, '');
      opt.value = sort;
      container.appendChild(opt);
    });
    renderBin.appendChild(container);
    select.appendChild(renderBin);
    select.value = prefs.get('manage.newUI.sort');
  }

  function sort({styles}) {
    const sortBy = prefs.get('manage.newUI.sort').split(splitRegex);
    const len = sortBy.length;
    return styles.sort((a, b) => {
      let types, direction;
      let result = 0;
      let index = 0;
      // multi-sort
      while (result === 0 && index < len) {
        types = tagData[sortBy[index++]];
        direction = sortBy[index++] === 'asc' ? 1 : -1;
        result = types.sorter(types.parse(a), types.parse(b)) * direction;
      }
      return result;
    });
  }

  function update() {
    if (!installed) return;
    const current = [...installed.children];
    const sorted = sort({
      styles: current.map(entry => ({
        entry,
        name: entry.styleNameLowerCase + '\n' + entry.styleMeta.name,
        style: BG.cachedStyles.byId.get(entry.styleId),
      }))
    });
    if (current.some((entry, index) => entry !== sorted[index].entry)) {
      const renderBin = document.createDocumentFragment();
      sorted.forEach(({entry}) => renderBin.appendChild(entry));
      installed.appendChild(renderBin);
      updateStripes();
    }
  }

  function updateStripes() {
    let index = 0;
    [...installed.children].forEach(entry => {
      const list = entry.classList;
      if (!list.contains('hidden')) {
        list.add(index % 2 ? 'odd' : 'even');
        list.remove(index++ % 2 ? 'even' : 'odd');
      }
    });
  }

  function showHelp(event) {
    event.preventDefault();
    messageBox({
      className: 'help-text',
      title: t('sortStylesHelpTitle'),
      contents:
        $create('div',
          t('sortStylesHelp').split('\n').map(line =>
            $create('p', line))),
      buttons: [t('confirmOK')],
    });
  }

  function init() {
    prefs.subscribe(['manage.newUI.sort'], update);
    $('#sorter-help').onclick = showHelp;
    addOptions();
  }

  return {init, update, sort, updateStripes};
})();

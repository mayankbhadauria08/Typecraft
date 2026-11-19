/* Support inbox.
   GET /api/console/support?q=&status=&topic=&who=&page=
     → { items: [{ id, name, email, topic, topicLabel, snippet, priority, status, createdAt, lastActivity, replies, customerId, assignedTo: { id, name } | null }],
         page, pageSize, pages, total, counts: { new, answered, closed }, topics, staff: [{ id, name, role }] } */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var counts = document.getElementById('statusCounts');
  var who = document.querySelector('#filters select[name="who"]');

  function row(m) {
    var open = AC.base + '/support/' + encodeURIComponent(m.id);
    return el('tr', null, [
      el('td', null, [
        el('a', { class: 'cell-link', href: open, text: m.name || m.email }),
        el('div', { class: 'cell-sub', text: m.email }),
        // on a phone the other columns fold into this one
        el('div', { class: 'person-extra' }, [AC.status('support', m.status), el('span', { text: m.topicLabel }), el('span', { text: AC.fmt.ago(m.createdAt) })])
      ]),
      el('td', { class: 'col-wide' }, [
        m.priority ? AC.badge('Priority', 'warn') : null,
        el('div', { class: 'measure', text: m.snippet + (m.snippet.length >= 160 ? '…' : '') }),
        m.replies ? el('div', { class: 'cell-sub', text: m.replies === 1 ? '1 reply sent' : m.replies + ' replies sent' }) : null
      ]),
      el('td', { class: 'col-wide', text: m.topicLabel }),
      el('td', { class: 'col-fit' }, AC.status('support', m.status)),
      el('td', { class: 'col-wide', text: m.assignedTo ? m.assignedTo.name : '–' }),
      el('td', { class: 'col-wide nowrap', title: AC.fmt.dateTime(m.createdAt), text: AC.fmt.ago(m.createdAt) })
    ]);
  }

  AC.listPage({
    endpoint: '/api/console/support',
    noun: ['message', 'messages'],
    empty: 'No messages yet. Messages sent through the contact form appear here.',
    row: row,
    onData: function (data) {
      AC.options(who, data.staff.map(function (s) { return { id: s.id, name: s.name }; }));
      AC.clear(counts);
      [['new', 'New'], ['answered', 'Answered'], ['closed', 'Closed']].forEach(function (s) {
        counts.appendChild(el('span', { class: 'seg-count' }, [AC.status('support', s[0]), el('b', { text: (data.counts[s[0]] || 0).toLocaleString('en-IN') })]));
      });
    }
  });
})();

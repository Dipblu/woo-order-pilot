/*!
 * Order Pilot Widget
 * Embeddable AI support chat widget for WooCommerce food delivery stores.
 * No dependencies. Renders inside a Shadow DOM so host-site CSS can't leak in or out.
 *
 * USAGE (simplest):
 *   <script src="https://yourcdn.example.com/order-pilot-widget.js"
 *           data-webhook-url="https://dmhermoso.cloud/webhook/chat"
 *           data-business-name="Your Store"
 *           async></script>
 *
 * See WIDGET_README.md for full config options and WooCommerce embedding steps.
 */
(function () {
  'use strict';

  if (window.__orderPilotWidgetLoaded) return;
  window.__orderPilotWidgetLoaded = true;

  // ---------------------------------------------------------------------
  // 1. Config resolution — reads window.OrderPilotConfig if present,
  //    falls back to data-* attributes on the currently executing script tag,
  //    falls back to sane defaults.
  // ---------------------------------------------------------------------
  var currentScript = document.currentScript;
  var ds = (currentScript && currentScript.dataset) || {};
  var userConfig = window.OrderPilotConfig || {};

  var config = {
    webhookUrl: userConfig.webhookUrl || ds.webhookUrl || 'https://dmhermoso.cloud/webhook/chat',
    businessName: userConfig.businessName || ds.businessName || 'Support',
    welcomeMessage: userConfig.welcomeMessage || ds.welcomeMessage ||
      "Hi! I can help with order status, menu questions, or getting you to a human if something's gone wrong. " +
      "For an order update, include your order number and the email you ordered with. What do you need?",
    launcherLabel: userConfig.launcherLabel || ds.launcherLabel || 'Chat with us',
    position: (userConfig.position || ds.position || 'right').toLowerCase() === 'left' ? 'left' : 'right',
    accentColor: userConfig.accentColor || ds.accentColor || '#C1440E',
    accentColorDark: userConfig.accentColorDark || ds.accentColorDark || '#9A3609',
    // Response field names to try, in order, when parsing the webhook's JSON reply.
    responseFields: userConfig.responseFields || ['answer', 'output', 'response', 'message', 'text', 'reply'],
    historyLimit: 50
  };

  // ---------------------------------------------------------------------
  // 2. Tiny utilities
  // ---------------------------------------------------------------------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* storage unavailable, degrade silently */ }
  }

  var SESSION_KEY = 'orderpilot_session_id';
  var HISTORY_KEY = 'orderpilot_history';

  function getSessionId() {
    var id = storageGet(SESSION_KEY);
    if (!id) {
      id = uuid();
      storageSet(SESSION_KEY, id);
    }
    return id;
  }

  function loadHistory() {
    var raw = storageGet(HISTORY_KEY);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(history) {
    var trimmed = history.slice(-config.historyLimit);
    storageSet(HISTORY_KEY, JSON.stringify(trimmed));
  }

  // ---------------------------------------------------------------------
  // 3. Styles (injected into the shadow root — cannot collide with host CSS)
  // ---------------------------------------------------------------------
  var css = `
    :host, * { box-sizing: border-box; }
    .op-root {
      --op-accent: ${config.accentColor};
      --op-accent-dark: ${config.accentColorDark};
      --op-bg: #FFF8F0;
      --op-surface: #FFFFFF;
      --op-text: #2B2420;
      --op-text-muted: #7A6F63;
      --op-success: #4C7A4C;
      --op-danger: #B3261E;
      --op-border: #EDE3D6;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      position: fixed;
      bottom: 20px;
      ${config.position}: 20px;
      z-index: 2147483000;
    }

    /* ---- Launcher ---- */
    .op-launcher {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--op-accent);
      color: #fff;
      border: none;
      border-radius: 999px;
      padding: 14px 20px 14px 16px;
      box-shadow: 0 8px 24px rgba(43, 36, 32, 0.28);
      cursor: pointer;
      font-size: 14.5px;
      font-weight: 600;
      letter-spacing: 0.1px;
      transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
    }
    .op-launcher:hover { background: var(--op-accent-dark); transform: translateY(-1px); box-shadow: 0 10px 28px rgba(43, 36, 32, 0.34); }
    .op-launcher:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .op-launcher svg { width: 22px; height: 22px; flex-shrink: 0; }
    .op-launcher.op-hidden { display: none; }

    /* ---- Panel ---- */
    .op-panel {
      position: absolute;
      bottom: 0;
      ${config.position}: 0;
      width: 380px;
      max-width: calc(100vw - 24px);
      height: 580px;
      max-height: calc(100vh - 100px);
      background: var(--op-surface);
      border-radius: 18px;
      box-shadow: 0 20px 60px rgba(43, 36, 32, 0.32);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform-origin: bottom ${config.position};
      transform: scale(0.92) translateY(12px);
      opacity: 0;
      pointer-events: none;
      transition: transform 180ms ease, opacity 180ms ease;
    }
    .op-panel.op-open { transform: scale(1) translateY(0); opacity: 1; pointer-events: auto; }
    @media (prefers-reduced-motion: reduce) {
      .op-panel { transition: opacity 120ms ease; transform: none !important; }
    }
    @media (max-width: 480px) {
      .op-panel {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        max-width: 100%;
        max-height: 100%;
        border-radius: 0;
      }
    }

    /* ---- Header ---- */
    .op-header {
      background: var(--op-text);
      color: #fff;
      padding: 16px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .op-header-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .op-header-title strong { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .op-eyebrow { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #C9C0B6; letter-spacing: 0.3px; text-transform: uppercase; }
    .op-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--op-success); animation: op-pulse 2s ease-in-out infinite; flex-shrink: 0; }
    @keyframes op-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .op-header-actions { display: flex; align-items: center; gap: 4px; }
    .op-icon-btn {
      background: transparent; border: none; color: #fff; opacity: 0.75; cursor: pointer;
      width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
      transition: opacity 120ms ease, background 120ms ease;
    }
    .op-icon-btn:hover { opacity: 1; background: rgba(255,255,255,0.12); }
    .op-icon-btn:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
    .op-icon-btn svg { width: 17px; height: 17px; }

    /* ---- Messages ---- */
    .op-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: var(--op-bg);
    }
    .op-row { display: flex; }
    .op-row.op-user { justify-content: flex-end; }
    .op-row.op-bot { justify-content: flex-start; }
    .op-bubble {
      max-width: 82%;
      padding: 10px 13px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .op-row.op-bot .op-bubble {
      background: var(--op-surface);
      color: var(--op-text);
      border: 1px solid var(--op-border);
      border-left: 3px solid var(--op-accent);
      border-bottom-left-radius: 4px;
    }
    .op-row.op-user .op-bubble {
      background: var(--op-text);
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .op-row.op-error .op-bubble {
      background: #FBEAE9; color: var(--op-danger); border: 1px solid #F2C9C6; border-left: 3px solid var(--op-danger);
    }

    /* Typing indicator with a small "simmer" animation */
    .op-typing { display: flex; align-items: center; gap: 4px; padding: 12px 13px; }
    .op-typing span {
      width: 6px; height: 6px; border-radius: 50%; background: var(--op-text-muted);
      animation: op-simmer 1.1s ease-in-out infinite;
    }
    .op-typing span:nth-child(2) { animation-delay: 0.15s; }
    .op-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes op-simmer { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }

    /* ---- Composer ---- */
    .op-composer {
      flex-shrink: 0;
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 10px;
      border-top: 1px solid var(--op-border);
      background: var(--op-surface);
    }
    .op-input {
      flex: 1;
      resize: none;
      border: 1px solid var(--op-border);
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 14px;
      font-family: inherit;
      color: var(--op-text);
      max-height: 96px;
      min-height: 40px;
      line-height: 1.4;
    }
    .op-input:focus-visible { outline: 2px solid var(--op-accent); outline-offset: 1px; }
    .op-send {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: var(--op-accent);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 120ms ease, transform 120ms ease;
    }
    .op-send:hover:not(:disabled) { background: var(--op-accent-dark); }
    .op-send:disabled { opacity: 0.45; cursor: not-allowed; }
    .op-send:focus-visible { outline: 2px solid var(--op-accent-dark); outline-offset: 2px; }
    .op-send svg { width: 17px; height: 17px; }

    .op-footer-note {
      text-align: center;
      font-size: 10.5px;
      color: var(--op-text-muted);
      padding: 4px 0 8px;
      background: var(--op-surface);
    }

    .op-visually-hidden {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
    }
  `;

  // ---------------------------------------------------------------------
  // 4. Icons (inline SVG, currentColor)
  // ---------------------------------------------------------------------
  var ICONS = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>'
  };

  // ---------------------------------------------------------------------
  // 5. Build DOM
  // ---------------------------------------------------------------------
  var host = document.createElement('div');
  host.id = 'order-pilot-widget-host';
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: 'open' });

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  shadow.appendChild(styleEl);

  var root = document.createElement('div');
  root.className = 'op-root';
  root.innerHTML =
    '<button class="op-launcher" type="button" aria-haspopup="dialog" aria-expanded="false">' +
      ICONS.chat + '<span>' + escapeHtml(config.launcherLabel) + '</span>' +
    '</button>' +
    '<section class="op-panel" role="dialog" aria-modal="false" aria-label="' + escapeHtml(config.businessName) + ' chat">' +
      '<header class="op-header">' +
        '<div class="op-header-title">' +
          '<strong>' + escapeHtml(config.businessName) + '</strong>' +
          '<span class="op-eyebrow"><span class="op-dot" aria-hidden="true"></span>AI Assistant</span>' +
        '</div>' +
        '<div class="op-header-actions">' +
          '<button class="op-icon-btn op-reset" type="button" title="Start a new conversation" aria-label="Start a new conversation">' + ICONS.refresh + '</button>' +
          '<button class="op-icon-btn op-close" type="button" title="Close chat" aria-label="Close chat">' + ICONS.close + '</button>' +
        '</div>' +
      '</header>' +
      '<div class="op-messages" role="log" aria-live="polite" aria-relevant="additions"></div>' +
      '<form class="op-composer">' +
        '<label class="op-visually-hidden" for="op-input">Message</label>' +
        '<textarea class="op-input" id="op-input" rows="1" placeholder="Type your message..." autocomplete="off"></textarea>' +
        '<button class="op-send" type="submit" aria-label="Send message">' + ICONS.send + '</button>' +
      '</form>' +
      '<div class="op-footer-note">AI-generated responses. Ask to speak to a person anytime.</div>' +
    '</section>';
  shadow.appendChild(root);

  var launcherEl = root.querySelector('.op-launcher');
  var panelEl = root.querySelector('.op-panel');
  var closeEl = root.querySelector('.op-close');
  var resetEl = root.querySelector('.op-reset');
  var messagesEl = root.querySelector('.op-messages');
  var formEl = root.querySelector('.op-composer');
  var inputEl = root.querySelector('.op-input');
  var sendEl = root.querySelector('.op-send');

  // ---------------------------------------------------------------------
  // 6. State + rendering
  // ---------------------------------------------------------------------
  var sessionId = getSessionId();
  var history = loadHistory();
  var isOpen = false;
  var isSending = false;

  function renderMessage(role, text, isError) {
    var row = document.createElement('div');
    row.className = 'op-row op-' + (isError ? 'error' : role);
    var bubble = document.createElement('div');
    bubble.className = 'op-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  function renderHistory() {
    messagesEl.innerHTML = '';
    if (history.length === 0) {
      renderMessage('bot', config.welcomeMessage, false);
    } else {
      history.forEach(function (m) { renderMessage(m.role, m.text, false); });
    }
  }

  function showTyping() {
    var row = document.createElement('div');
    row.className = 'op-row op-bot op-typing-row';
    row.innerHTML = '<div class="op-bubble op-typing"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  function setSending(state) {
    isSending = state;
    sendEl.disabled = state;
    inputEl.disabled = state;
  }

  // ---------------------------------------------------------------------
  // 6b. Client-side slot filling for order lookups.
  //
  //     The backend is stateless: it ignores sessionId entirely and classifies
  //     each message on its own (verified against production 2026-08-02). So a
  //     natural exchange — "where is my order?" -> "754" -> "me@example.com" —
  //     can never work server-side. The bare "754" matches no order keyword,
  //     falls through to the FAQ/RAG path, and comes back as "I'm not able to
  //     find information about that", which is a dead end.
  //
  //     The workflow only succeeds when one message carries BOTH the order
  //     number and the billing email, so we collect them on the client and
  //     send a single well-formed question. This is deliberately the only
  //     state the widget infers — it is not general conversation memory.
  // ---------------------------------------------------------------------
  var ASK_FOR_ORDER_INFO_MARKER = 'could you share your order number and the email';
  var EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
  var slots = { orderNumber: null, email: null };
  var awaitingOrderInfo = false;

  function extractOrderNumber(text, allowBareNumber) {
    var m = text.match(/order\s*#?\s*(\d{2,8})/i) || text.match(/#(\d{2,8})\b/);
    if (m) return m[1];
    if (allowBareNumber) {
      var bare = text.match(/\b(\d{2,8})\b/);
      if (bare) return bare[1];
    }
    return null;
  }

  function resetSlots() {
    slots = { orderNumber: null, email: null };
    awaitingOrderInfo = false;
  }

  // ---------------------------------------------------------------------
  // 7. Networking
  // ---------------------------------------------------------------------
  function extractReplyText(data) {
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') {
      for (var i = 0; i < config.responseFields.length; i++) {
        var field = config.responseFields[i];
        if (typeof data[field] === 'string' && data[field].trim()) return data[field];
      }
      // n8n sometimes wraps output in an array of items, e.g. [{ output: "..." }]
      if (Array.isArray(data) && data.length && typeof data[0] === 'object') {
        return extractReplyText(data[0]);
      }
    }
    return null;
  }

  function replyLocally(text) {
    history.push({ role: 'bot', text: text });
    renderMessage('bot', text, false);
    saveHistory(history);
  }

  function sendMessage(text) {
    if (!text.trim() || isSending) return;

    history.push({ role: 'user', text: text });
    renderMessage('user', text, false);
    saveHistory(history);

    // Harvest any order number / email from what the user just typed. A bare
    // number only counts as an order number when we've actually just asked
    // for one, so ordinary messages containing digits aren't misread.
    var emailMatch = text.match(EMAIL_RE);
    if (emailMatch) slots.email = emailMatch[0];
    var foundNumber = extractOrderNumber(text, awaitingOrderInfo);
    if (foundNumber) slots.orderNumber = foundNumber;

    var outboundQuestion = text;
    if (awaitingOrderInfo) {
      if (slots.orderNumber && slots.email) {
        // Re-form the request the way the workflow's classifier can parse.
        outboundQuestion = 'What is the status of order ' + slots.orderNumber +
          '? My email is ' + slots.email;
        awaitingOrderInfo = false;
      } else if (slots.orderNumber || slots.email) {
        // Still missing a piece. Ask for exactly that piece here rather than
        // spending a backend call (and an LLM call) that can only dead-end.
        replyLocally(slots.orderNumber
          ? 'Thanks — I have order #' + slots.orderNumber +
            '. What email address was used when placing it?'
          : 'Thanks. What is the order number for that order?');
        saveHistory(history);
        return;
      }
    }

    setSending(true);
    var typingRow = showTyping();

    fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: outboundQuestion, sessionId: sessionId })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed with status ' + res.status);
        var contentType = res.headers.get('content-type') || '';
        return contentType.indexOf('application/json') !== -1 ? res.json() : res.text();
      })
      .then(function (data) {
        typingRow.remove();
        var replyText = extractReplyText(data) ||
          "I got a response back but couldn't read it — could you try rephrasing, or ask to speak with a person?";
        // If the backend just asked for order details, start collecting them
        // client-side so the follow-up messages can be combined into one.
        awaitingOrderInfo =
          replyText.toLowerCase().indexOf(ASK_FOR_ORDER_INFO_MARKER) !== -1;
        history.push({ role: 'bot', text: replyText });
        renderMessage('bot', replyText, false);
        saveHistory(history);
      })
      .catch(function () {
        typingRow.remove();
        var errorText = "Sorry, I couldn't reach support right now. Please try again in a moment.";
        renderMessage('bot', errorText, true);
      })
      .finally(function () {
        setSending(false);
        inputEl.focus();
      });
  }

  // ---------------------------------------------------------------------
  // 8. Interaction wiring
  // ---------------------------------------------------------------------
  function openPanel() {
    isOpen = true;
    panelEl.classList.add('op-open');
    launcherEl.setAttribute('aria-expanded', 'true');
    launcherEl.classList.add('op-hidden');
    renderHistory();
    setTimeout(function () { inputEl.focus(); }, 180);
  }

  function closePanel() {
    isOpen = false;
    panelEl.classList.remove('op-open');
    launcherEl.setAttribute('aria-expanded', 'false');
    launcherEl.classList.remove('op-hidden');
    launcherEl.focus();
  }

  launcherEl.addEventListener('click', openPanel);
  closeEl.addEventListener('click', closePanel);

  resetEl.addEventListener('click', function () {
    if (isSending) return;
    history = [];
    saveHistory(history);
    sessionId = uuid();
    storageSet(SESSION_KEY, sessionId);
    resetSlots();
    renderHistory();
    inputEl.focus();
  });

  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = inputEl.value;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendMessage(text);
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit ? formEl.requestSubmit() : formEl.dispatchEvent(new Event('submit', { cancelable: true }));
    }
    if (e.key === 'Escape') closePanel();
  });

  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 96) + 'px';
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) closePanel();
  });

  // ---------------------------------------------------------------------
  // 9. Public API (window.OrderPilot) — lets the host page open/close/reset
  //    the widget programmatically, e.g. from a "Track your order" button.
  // ---------------------------------------------------------------------
  window.OrderPilot = {
    open: openPanel,
    close: closePanel,
    reset: function () { resetEl.click(); },
    sendMessage: function (text) { openPanel(); sendMessage(text); }
  };
})();
